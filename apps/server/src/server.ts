import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  MAX_CHAT_LENGTH,
  maxPlayersFromId,
  type Address,
  type ClientToServerEvents,
  type LobbyGame,
  type ServerToClientEvents,
} from "@tankdawgs/shared";
import { verifyAuth } from "./auth.js";
import { createChainReader, type ChainReader } from "./chain.js";
import { startChainListener } from "./chain-events.js";
import type { ServerConfig } from "./config.js";
import { LeaderboardStore } from "./leaderboard.js";
import { LobbyStore } from "./lobby.js";
import { ProfileStore } from "./profile.js";
import { createRelayer, type Relayer } from "./relayer.js";
import { GameRoom, type RoomEmitter } from "./room.js";

interface SocketData {
  address?: Address;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface TankDawgsServer {
  httpServer: HttpServer;
  io: IoServer;
  lobby: LobbyStore;
  rooms: Map<string, GameRoom>;
  close(): Promise<void>;
}

const roomChannel = (gameId: string) => `game:${gameId}`;

export function createTankDawgsServer(
  config: ServerConfig,
  relayer: Relayer = createRelayer(config),
  chainReader: ChainReader = createChainReader(config)
): TankDawgsServer {
  const leaderboard = new LeaderboardStore();
  const profiles = new ProfileStore(config.dataDir);

  // Accept the configured origins PLUS any localhost / 127.0.0.1 origin (any
  // port). This avoids the common local-testing trap where the page is opened
  // on 127.0.0.1 but CORS only allowed localhost (or vice versa), which
  // silently blocks the WebSocket and leaves the client stuck "connecting".
  const isAllowedOrigin = (origin?: string): boolean => {
    if (!origin) return true; // non-browser clients (curl, node, the e2e)
    if (config.corsOrigins.includes(origin)) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  };

  const httpServer = createHttpServer((req, res) => {
    const origin = req.headers.origin;
    const cors = {
      "access-control-allow-origin": isAllowedOrigin(origin) ? origin ?? "*" : "null",
    };
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true, chainEnabled: config.chainEnabled }));
      return;
    }
    if (req.url === "/leaderboard") {
      res.writeHead(200, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify({ entries: leaderboard.top(), stats: leaderboard.stats() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const io: IoServer = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) },
  });

  const lobby = new LobbyStore();
  const rooms = new Map<string, GameRoom>();
  const stopChainListener = startChainListener(config, lobby, leaderboard);

  // Decorate lobby rows with the creator's display name so the browse list and
  // join screens can show who's hosting.
  const withNames = (games: LobbyGame[]): LobbyGame[] =>
    games.map((g) => ({ ...g, creatorName: profiles.getName(g.creator) }));

  lobby.onChange(() => {
    io.to("lobby").emit("lobby:state", { games: withNames(lobby.list()) });
  });

  function makeEmitter(gameId: string): RoomEmitter {
    const channel = roomChannel(gameId);
    return {
      broadcastShot: (p) => io.to(channel).emit("game:shot", p),
      broadcastState: (p) => io.to(channel).emit("room:state", p),
      broadcastOver: (p) => {
        io.to(channel).emit("game:over", p);
        lobby.markStatus(gameId, "finished");
        const room = rooms.get(gameId);
        // Record once, on the first (pre-settlement) game:over emit. Skip the
        // mutual-KO draw (winner is the zero address).
        const ZERO = "0x0000000000000000000000000000000000000000";
        if (room && !p.txHash && p.winner !== ZERO) {
          const losers = room.seats.filter((s) => s !== p.winner.toLowerCase());
          // Winner takes 80% of the whole pot (stake × players).
          const stake = lobby.get(gameId)?.stake ?? room.stakeWei() ?? "0";
          const winnings = ((BigInt(stake) * BigInt(room.seats.length) * 8000n) / 10000n).toString();
          leaderboard.record(gameId, p.winner, losers, winnings);
          // Surface as a claimable win immediately (idempotent with the chain
          // backfill, which also records it once finishGame mines).
          leaderboard.recordWonGame(p.winner, gameId, winnings);
        }
      },
    };
  }

  /**
   * Resolve the full seat roster (and stake) for a game. With the chain enabled,
   * seats are read straight from the contract — authoritative and immune to
   * event-listener lag. The room only forms once the table is full. In dev mode
   * the first N distinct authenticated wallets to join an unknown gameId become
   * the players (N encoded in the code prefix, TD<N>-…).
   */
  const devSeats = new Map<string, Address[]>();
  async function resolveSeats(
    gameId: string,
    joiner: Address
  ): Promise<{ seats: Address[]; stake: string | null } | null> {
    if (config.chainEnabled) {
      const game = await chainReader.getGame(gameId);
      if (!game || game.isCompleted) return null;
      if (game.players.length < game.maxPlayers) return null; // not full yet
      const seats = game.players.map((p) => p.toLowerCase() as Address);
      if (!seats.includes(joiner)) return null;
      return { seats, stake: game.stake.toString() };
    }
    const max = maxPlayersFromId(gameId);
    const pending = devSeats.get(gameId) ?? [];
    if (!pending.includes(joiner)) {
      if (pending.length >= max) return null;
      pending.push(joiner);
      devSeats.set(gameId, pending);
    }
    return pending.length === max ? { seats: [...pending], stake: null } : null;
  }

  io.on("connection", (socket) => {
    socket.on("lobby:subscribe", () => {
      void socket.join("lobby");
      socket.emit("lobby:state", { games: withNames(lobby.list()) });
    });

    socket.on("lobby:unsubscribe", () => {
      void socket.leave("lobby");
    });

    socket.on("room:join", async ({ gameId, auth }) => {
      const address = verifyAuth(auth);
      if (!address) {
        console.warn(`[room] join ${gameId}: bad signature`);
        socket.emit("server:error", { code: "unauthorized", message: "bad signature" });
        return;
      }
      socket.data.address = address;
      console.log(`[room] join ${gameId} by ${address}`);

      let room = rooms.get(gameId);
      if (!room) {
        const resolved = await resolveSeats(gameId, address);
        if (!resolved) {
          console.warn(`[room] join ${gameId}: not joinable for ${address}`);
          // Dev mode: first player waits for an opponent before a room exists.
          if (!config.chainEnabled && devSeats.get(gameId)?.includes(address)) {
            void socket.join(roomChannel(gameId));
            return;
          }
          socket.emit("server:error", {
            code: "unknown-game",
            message: "game not joinable (not active on-chain, or not a player)",
          });
          return;
        }
        // Another join may have created the room while we awaited the chain.
        room =
          rooms.get(gameId) ??
          new GameRoom(
            gameId,
            resolved.seats,
            makeEmitter(gameId),
            relayer,
            config.turnClockMs,
            resolved.stake,
            (addr) => profiles.getName(addr)
          );
        rooms.set(gameId, room);
      }

      if (room.seatOf(address) === null) {
        console.warn(`[room] join ${gameId}: ${address} is not a seated player`);
        socket.emit("server:error", { code: "not-a-player", message: "spectating not yet supported" });
        return;
      }

      void socket.join(roomChannel(gameId));
      room.connect(address);
      socket.emit("room:state", room.snapshot());
      console.log(`[room] seated ${address} in ${gameId}`);
    });

    socket.on("room:leave", ({ gameId }) => {
      void socket.leave(roomChannel(gameId));
      const room = rooms.get(gameId);
      if (room && socket.data.address) room.disconnect(socket.data.address);
    });

    const withRoom = (
      gameId: string,
      fn: (room: GameRoom, address: Address) => void
    ): void => {
      const address = socket.data.address;
      if (!address) {
        socket.emit("server:error", { code: "unauthorized", message: "join the room first" });
        return;
      }
      const room = rooms.get(gameId);
      if (!room) {
        socket.emit("server:error", { code: "unknown-game", message: "no such room" });
        return;
      }
      fn(room, address);
    };

    socket.on("game:fire", ({ gameId, shot }) => {
      withRoom(gameId, (room, address) => {
        const result = room.handleFire(address, shot);
        if (!result.ok) socket.emit("server:error", result.error);
      });
    });

    socket.on("game:resign", ({ gameId }) => {
      withRoom(gameId, (room, address) => {
        const result = room.handleResign(address);
        if (!result.ok) socket.emit("server:error", result.error);
      });
    });

    socket.on("chat:send", ({ gameId, text }) => {
      withRoom(gameId, (room, address) => {
        if (room.seatOf(address) === null) {
          socket.emit("server:error", { code: "chat-rejected", message: "players only" });
          return;
        }
        const trimmed = String(text ?? "").trim().slice(0, MAX_CHAT_LENGTH);
        if (!trimmed) return;
        const msg = { gameId, from: address, text: trimmed, ts: Date.now() };
        room.addChat(msg); // persist so a reconnecting player sees it
        io.to(roomChannel(gameId)).emit("chat:message", msg);
      });
    });

    const emitProfile = async (address: Address): Promise<void> => {
      const key = address.toLowerCase() as Address;
      const stats = leaderboard.entry(key);
      // Sign a fresh voucher for each won game so the winner can claim it from
      // the profile (deterministic — re-signing yields the same voucher).
      const wonGames = await Promise.all(
        leaderboard.wonGames(key).map(async (g) => ({
          ...g,
          voucher: (await relayer.signResult(g.gameId, key)) ?? null,
        }))
      );
      socket.emit("profile:state", {
        address: key,
        username: profiles.getName(key),
        wins: stats.wins,
        losses: stats.losses,
        wonAmount: stats.wonAmount,
        wonGames,
      });
    };

    socket.on("profile:get", ({ address }) => {
      if (typeof address === "string" && address) void emitProfile(address as Address);
    });

    socket.on("profile:set", ({ auth, username }) => {
      const address = verifyAuth(auth);
      if (!address) {
        socket.emit("server:error", { code: "unauthorized", message: "bad signature" });
        return;
      }
      const stored = profiles.setName(address, String(username ?? ""));
      console.log(`[profile] ${address} → ${stored ? JSON.stringify(stored) : "(cleared)"}`);
      void emitProfile(address);
      // Reflect the new name in any open rooms + the lobby browse list.
      for (const room of rooms.values()) {
        if (room.seatOf(address) !== null) io.to(roomChannel(room.gameId)).emit("room:state", room.snapshot());
      }
      io.to("lobby").emit("lobby:state", { games: withNames(lobby.list()) });
    });

    socket.on("disconnect", () => {
      const address = socket.data.address;
      if (!address) return;
      for (const room of rooms.values()) {
        if (room.seatOf(address) !== null) room.disconnect(address);
      }
    });
  });

  return {
    httpServer,
    io,
    lobby,
    rooms,
    async close() {
      stopChainListener();
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      await io.close();
    },
  };
}
