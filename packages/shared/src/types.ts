import type { DamageEvent, GameState, Shell, ShotInput } from "@tankdawgs/engine";

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
  /** Players per team: 0 = free-for-all; 2/3/4 = 2v2/3v3/4v4. */
  teamSize: number;
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
  /** Set when the battle ends. `winners` is the winning team's roster (one
   *  address in a free-for-all); `vouchers` maps each winner's (lowercased)
   *  address to the EIP-712 signature they submit to claimRewardSigned. */
  over: {
    winners: Address[];
    reason: GameOverReason;
    vouchers?: Record<string, string>;
    txHash?: string;
  } | null;
}

/** Broadcast after the server validated and simulated a shot. The full shot
 *  resolution is included so clients animate it directly (no client re-sim). */
export interface ShotBroadcast {
  gameId: string;
  bySeat: number;
  shot: ShotInput;
  /** Hash of the state the shot was simulated FROM (clients verify sync). */
  preStateHash: string;
  /** Every projectile (staged) + per-seat damage, for the animation. */
  shells: Shell[];
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

/** A scheduled clan activity or inter-clan challenge (off-chain coordination
 *  layer, referencing the on-chain clans). When the host launches it, a team/FFA
 *  game code is minted that participants open to play. */
export interface ClanEvent {
  id: string;
  /** "challenge" names an opponent clan; "activity" is open to anyone. */
  kind: "challenge" | "activity";
  title: string;
  host: Address;
  hostName?: string | null;
  /** Host's clan tag, decorated at emit time. */
  hostClanTag?: string | null;
  /** For a challenge: the opponent clan's tag. */
  opponentClanTag?: string | null;
  /** 0 = free-for-all, 2/3/4 = team match (drives the minted code). */
  teamSize: number;
  /** Total seats for the match. */
  maxPlayers: number;
  /** Per-player stake in $DDawgs (display string), optional. */
  stake?: string;
  /** Epoch ms the activity is planned for. */
  scheduledAt: number;
  /** Addresses that have RSVP'd. */
  rsvps: Address[];
  /** Set once the host launches — the gameId participants open. */
  gameCode?: string;
  createdAt: number;
}

export const MAX_EVENT_TITLE = 60;

/** Per-turn clock, enforced off-chain by the server (never on-chain). Run out of
 *  time on your turn and you forfeit. */
export const TURN_CLOCK_MS = 45 * 1000;

export const MAX_CHAT_LENGTH = 280;

export const MAX_USERNAME_LENGTH = 24;
