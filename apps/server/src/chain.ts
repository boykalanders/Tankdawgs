import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { TANK_DAWGS_ABI } from "@tankdawgs/shared";
import type { ServerConfig } from "./config.js";

export interface ChainGame {
  players: string[];
  maxPlayers: number;
  stake: bigint;
  isCompleted: boolean;
  winner: string;
  rewardClaimed: boolean;
}

export interface ChainReader {
  /** Read a game straight from the contract — authoritative, no event lag. */
  getGame(gameId: string): Promise<ChainGame | null>;
}

/**
 * Reads game state directly from the chain. Seat resolution uses this rather
 * than the event-mirrored lobby, so a join is never blocked by event-listener
 * lag or a public RPC dropping a log filter.
 */
export function createChainReader(config: ServerConfig): ChainReader {
  if (!config.chainEnabled) {
    return { async getGame() { return null; } };
  }
  const provider = new JsonRpcProvider(config.rpcUrl!, undefined, { staticNetwork: true });
  const contract = new Contract(config.contractAddress!, TANK_DAWGS_ABI, provider);

  return {
    async getGame(gameId: string): Promise<ChainGame | null> {
      try {
        const g = await contract.getGame(gameId);
        const players = ((g.players ?? g[0]) as string[]).map((p) => p.toLowerCase());
        const maxPlayers = Number(g.maxPlayers ?? g[1]);
        if (maxPlayers === 0) return null; // no such game
        return {
          players,
          maxPlayers,
          stake: (g.stake ?? g[2]) as bigint,
          isCompleted: (g.isCompleted ?? g[3]) as boolean,
          winner: (g.winner ?? g[4]) as string,
          rewardClaimed: (g.rewardClaimed ?? g[5]) as boolean,
        };
      } catch (e) {
        console.error(
          `[chain] getGame(${gameId}) failed:`,
          e instanceof Error ? e.message : e
        );
        return null;
      }
    },
  };
}

export { ZeroAddress };
