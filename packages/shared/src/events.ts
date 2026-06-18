import type { ShotInput } from "@tankdawgs/engine";
import type {
  Address,
  ChatMessage,
  ClanEvent,
  GameOverReason,
  LobbyGame,
  PlayerProfile,
  RoomSnapshot,
  ShotBroadcast,
} from "./types.js";

/** Payload to schedule a clan activity / challenge. */
export interface NewEventInput {
  kind: "challenge" | "activity";
  title: string;
  teamSize: number;
  maxPlayers: number;
  opponentClanTag?: string;
  stake?: string;
  scheduledAt: number;
}

/** Wallet-signature auth payload. The client signs `loginMessage(address, ts)`
 *  and the server verifies it; valid for AUTH_TTL_MS. */
export interface AuthPayload {
  address: Address;
  /** Epoch ms used in the signed message. */
  ts: number;
  signature: string;
}

export const AUTH_TTL_MS = 5 * 60 * 1000;

export function loginMessage(address: Address, ts: number): string {
  return `TankDawgs login\naddress: ${address.toLowerCase()}\nts: ${ts}`;
}

export interface ServerError {
  code:
    | "unauthorized"
    | "not-your-turn"
    | "illegal-shot"
    | "unknown-game"
    | "not-a-player"
    | "chat-rejected"
    | "internal";
  message: string;
}

/** Events the client may emit. */
export interface ClientToServerEvents {
  "lobby:subscribe": () => void;
  "lobby:unsubscribe": () => void;
  "room:join": (p: { gameId: string; auth: AuthPayload }) => void;
  "room:leave": (p: { gameId: string }) => void;
  "game:fire": (p: { gameId: string; shot: ShotInput }) => void;
  /** Drive the tank one step on your turn (dir −1 = west, +1 = east). */
  "game:drive": (p: { gameId: string; dir: number }) => void;
  "game:resign": (p: { gameId: string }) => void;
  "chat:send": (p: { gameId: string; text: string }) => void;
  /** Fetch a wallet's profile (name, stats, claimable wins). */
  "profile:get": (p: { address: Address }) => void;
  /** Set your own display name (authenticated with a wallet signature). */
  "profile:set": (p: { auth: AuthPayload; username: string }) => void;
  // ── clan events / challenges ──
  "events:subscribe": () => void;
  "events:unsubscribe": () => void;
  "events:create": (p: { auth: AuthPayload; event: NewEventInput }) => void;
  "events:rsvp": (p: { auth: AuthPayload; id: string }) => void;
  /** Host mints a game code for the event so participants can play. */
  "events:launch": (p: { auth: AuthPayload; id: string }) => void;
  "events:cancel": (p: { auth: AuthPayload; id: string }) => void;
}

/** Events the server may emit. */
export interface ServerToClientEvents {
  "lobby:state": (p: { games: LobbyGame[] }) => void;
  "room:state": (p: RoomSnapshot) => void;
  "game:shot": (p: ShotBroadcast) => void;
  "game:over": (p: {
    gameId: string;
    /** Winning team's roster (one address in a free-for-all). */
    winners: Address[];
    reason: GameOverReason;
    txHash?: string;
    /** Per-winner backend vouchers, keyed by lowercased address. */
    vouchers?: Record<string, string>;
  }) => void;
  "chat:message": (p: ChatMessage) => void;
  "profile:state": (p: PlayerProfile) => void;
  "events:state": (p: { events: ClanEvent[] }) => void;
  "server:error": (p: ServerError) => void;
}
