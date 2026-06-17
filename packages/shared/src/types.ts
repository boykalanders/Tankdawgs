import type { DamageEvent, GameState, Point, ShotInput } from "@tankdawgs/engine";

export type Address = `0x${string}`;

export type LobbyGameStatus = "open" | "active" | "finished" | "cancelled";

/** A game as listed in the lobby — mirrors on-chain state via the event listener. */
export interface LobbyGame {
  gameId: string;
  /** Seat-0 creator. */
  creator: Address;
  /** Stake per player, as a decimal string of wei. */
  stake: string;
  /** Seats in this battle (2…8). */
  maxPlayers: number;
  /** How many seats are filled so far. */
  playerCount: number;
  status: LobbyGameStatus;
  createdAt: number;
  /** Display name of the creator, if set (decorated at emit time). */
  creatorName?: string | null;
}

/** How a battle ended. */
export type GameOverReason = "ko" | "resign" | "timeout";

export interface RoomPlayer {
  address: Address;
  /** Seat index — matches the tank's seat in `GameState.tanks`. */
  seat: number;
  connected: boolean;
  /** Display name, if the player has set one. */
  username?: string | null;
}

/** Authoritative room snapshot pushed to clients on join and on every turn. */
export interface RoomSnapshot {
  gameId: string;
  players: RoomPlayer[];
  /** Per-player stake in wei (decimal string); null for chain-less dev tables. */
  stake: string | null;
  state: GameState;
  /** Server hash of `state` for desync detection. */
  stateHash: string;
  /** Chat history for the room, so a reconnecting player sees past messages. */
  messages: ChatMessage[];
  /** Epoch ms when the current player's turn clock expires. */
  clockExpiresAt: number;
  /** Set when the battle ends. `voucher` is the backend's EIP-712 signature the
   *  winner submits to claimRewardSigned; `txHash` only on the legacy path. */
  over: { winner: Address; reason: GameOverReason; txHash?: string; voucher?: string } | null;
}

/** Broadcast after the server validated and simulated a shot. The full shot
 *  resolution is included so clients animate it directly (no client re-sim). */
export interface ShotBroadcast {
  gameId: string;
  bySeat: number;
  shot: ShotInput;
  /** Hash of the state the shot was simulated FROM (clients verify sync). */
  preStateHash: string;
  /** Pellet polylines + impact points + per-seat damage, for the animation. */
  trajectories: Point[][];
  impacts: Point[];
  damage: DamageEvent[];
  /** Authoritative post-shot state — clients adopt it after animating. */
  endState: GameState;
  endStateHash: string;
  clockExpiresAt: number;
}

export interface ChatMessage {
  gameId: string;
  from: Address;
  text: string;
  ts: number;
}

export interface LeaderboardEntry {
  address: Address;
  wins: number;
  losses: number;
  /** Total winnings in wei (decimal string). */
  wonAmount: string;
}

/** Platform-wide totals shown on the leaderboard. */
export interface PlatformStats {
  /** Number of finished games. */
  games: number;
  /** Total $DDAWGS burned (10% of every pot), wei decimal string. */
  totalBurned: string;
  /** Total staked across all finished games, wei. */
  totalWagered: string;
}

/** A game the player won — the client checks each one's on-chain `rewardClaimed`
 *  flag to surface the still-claimable ones. */
export interface WonGame {
  gameId: string;
  /** Winner's payout in wei (80% of the pot), decimal string. */
  reward: string;
  /** Backend EIP-712 voucher to redeem via claimRewardSigned (when available). */
  voucher?: string | null;
}

/** Per-wallet profile served on demand: editable name + stats + claimable wins. */
export interface PlayerProfile {
  address: Address;
  username: string | null;
  wins: number;
  losses: number;
  /** Total winnings in wei (decimal string). */
  wonAmount: string;
  /** Games this wallet has won (newest first). */
  wonGames: WonGame[];
}

/** Per-turn clock, enforced off-chain by the server (never on-chain). Run out of
 *  time on your turn and you forfeit. */
export const TURN_CLOCK_MS = 45 * 1000;

export const MAX_CHAT_LENGTH = 280;

export const MAX_USERNAME_LENGTH = 24;
