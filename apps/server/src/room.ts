import {
  createInitialState,
  driveTank,
  seedFromString,
  simulateShot,
  stateHash,
  validateShot,
  MOVES_PER_TURN,
  type GameState,
  type ShotInput,
} from "@tankdawgs/engine";
import { teamSizeFromId } from "@tankdawgs/shared";
import type {
  Address,
  ChatMessage,
  GameOverReason,
  RoomSnapshot,
  ServerError,
  ShotBroadcast,
} from "@tankdawgs/shared";
import type { Relayer } from "./relayer.js";

export interface RoomEmitter {
  broadcastShot(p: ShotBroadcast): void;
  broadcastState(p: RoomSnapshot): void;
  broadcastOver(p: {
    gameId: string;
    winners: Address[];
    reason: GameOverReason;
    txHash?: string;
    vouchers?: Record<string, string>;
  }): void;
}

export type RoomActionResult = { ok: true } | { ok: false; error: ServerError };

function err(code: ServerError["code"], message: string): RoomActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * One authoritative room per on-chain gameId. All gameplay flows through here:
 * the room validates that inputs come from the seated player whose turn it is,
 * runs the deterministic artillery engine, enforces the per-turn clock, and
 * reports the last-tank-standing winner to the chain via a signed voucher.
 */
export class GameRoom {
  readonly gameId: string;
  readonly seats: Address[];
  private state: GameState;
  private connected = new Set<Address>();
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private clockExpiresAt = 0;
  private over: RoomSnapshot["over"] = null;
  private settling = false;
  private messages: ChatMessage[] = [];

  constructor(
    gameId: string,
    seats: Address[],
    private readonly emitter: RoomEmitter,
    private readonly relayer: Relayer,
    private readonly turnClockMs: number,
    private readonly stake: string | null = null,
    private readonly nameOf: (address: Address) => string | null = () => null
  ) {
    this.gameId = gameId;
    this.seats = seats.map((s) => s.toLowerCase() as Address);
    // Seed terrain from the gameId so the server and every client agree; the
    // code's prefix also says whether this is a team match (TD<S>V<S>-…).
    this.state = createInitialState({
      players: this.seats.length,
      seed: seedFromString(gameId),
      teamSize: teamSizeFromId(gameId),
    });
    this.restartClock();
  }

  seatOf(address: Address): number | null {
    const idx = this.seats.indexOf(address.toLowerCase() as Address);
    return idx === -1 ? null : idx;
  }

  isOver(): boolean {
    return this.over !== null;
  }

  /** Per-player stake in wei (decimal string), or null for dev tables. */
  stakeWei(): string | null {
    return this.stake;
  }

  addChat(msg: ChatMessage): void {
    this.messages.push(msg);
    if (this.messages.length > 100) this.messages.shift();
  }

  connect(address: Address): void {
    this.connected.add(address.toLowerCase() as Address);
    this.emitter.broadcastState(this.snapshot());
  }

  disconnect(address: Address): void {
    this.connected.delete(address.toLowerCase() as Address);
    // The turn clock keeps running — staying away past it forfeits your turn.
    this.emitter.broadcastState(this.snapshot());
  }

  snapshot(): RoomSnapshot {
    return {
      gameId: this.gameId,
      players: this.seats.map((address, seat) => ({
        address,
        seat,
        connected: this.connected.has(address),
        username: this.nameOf(address),
      })),
      stake: this.stake,
      state: this.state,
      stateHash: stateHash(this.state),
      messages: this.messages,
      clockExpiresAt: this.clockExpiresAt,
      over: this.over,
    };
  }

  handleFire(address: Address, shot: ShotInput): RoomActionResult {
    if (this.over) return err("illegal-shot", "game is over");
    const seat = this.seatOf(address);
    if (seat === null) return err("not-a-player", "not seated in this game");
    if (seat !== this.state.turn) return err("not-your-turn", "wait for your turn");

    const valid = validateShot(this.state, shot);
    if (!valid.ok) return err("illegal-shot", valid.reason ?? "illegal shot");

    const preHash = stateHash(this.state);
    const result = simulateShot(this.state, shot);
    this.state = result.endState;

    this.restartClock();
    this.emitter.broadcastShot({
      gameId: this.gameId,
      bySeat: seat,
      shot,
      preStateHash: preHash,
      shells: result.shells,
      damage: result.damage,
      endState: result.endState,
      endStateHash: stateHash(result.endState),
      clockExpiresAt: this.clockExpiresAt,
    });

    if (result.outcome.gameOver) {
      if (result.outcome.winningTeam !== null) void this.settle(result.outcome.winningTeam, "ko");
      else this.settleDraw();
    }
    return { ok: true };
  }

  handleDrive(address: Address, dir: number): RoomActionResult {
    if (this.over) return err("illegal-shot", "game is over");
    const seat = this.seatOf(address);
    if (seat === null) return err("not-a-player", "not seated in this game");
    if (seat !== this.state.turn) return err("not-your-turn", "wait for your turn");

    const next = driveTank(this.state, dir >= 0 ? 1 : -1);
    if (next === this.state) return { ok: true }; // no move available; ignore
    this.state = next;
    this.emitter.broadcastState(this.snapshot());
    return { ok: true };
  }

  handleResign(address: Address): RoomActionResult {
    if (this.over) return err("illegal-shot", "game is over");
    const seat = this.seatOf(address);
    if (seat === null) return err("not-a-player", "not seated in this game");
    this.eliminate(seat, "resign");
    return { ok: true };
  }

  /** Per-turn clock — enforced here, never on-chain. */
  private restartClock(): void {
    this.stopClock();
    this.clockExpiresAt = Date.now() + this.turnClockMs;
    this.clockTimer = setTimeout(() => this.onClockExpired(), this.turnClockMs);
  }

  private stopClock(): void {
    if (this.clockTimer) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private onClockExpired(): void {
    if (this.over || this.settling) return;
    // Run out of time on your turn and your tank is destroyed (keeps wagered
    // battles terminating; no stalling by disconnecting).
    this.eliminate(this.state.turn, "timeout");
  }

  private aliveTeams(): number[] {
    return [...new Set(this.state.tanks.filter((t) => t.alive).map((t) => t.team))];
  }

  private nextAliveSeat(from: number): number {
    const n = this.state.tanks.length;
    for (let i = 1; i <= n; i++) {
      const seat = (from + i) % n;
      if (this.state.tanks[seat].alive) return seat;
    }
    return from;
  }

  /** Remove a tank from the battle (resign / timeout). Ends the game if it
   *  leaves one survivor; otherwise play continues with the next alive seat. */
  private eliminate(seat: number, reason: GameOverReason): void {
    if (this.over || this.settling) return;
    const tank = this.state.tanks[seat];
    if (!tank || !tank.alive) return;

    const tanks = this.state.tanks.map((t) =>
      t.seat === seat ? { ...t, alive: false, health: 0 } : { ...t }
    );
    this.state = { ...this.state, tanks };

    const teams = this.aliveTeams();
    if (teams.length <= 1) {
      if (teams.length === 1) void this.settle(teams[0], reason);
      else this.settleDraw();
      return;
    }
    // Game continues — advance the turn if the eliminated player was on the clock.
    if (this.state.turn === seat) {
      this.state = { ...this.state, turn: this.nextAliveSeat(seat), movesLeft: MOVES_PER_TURN };
    }
    this.restartClock();
    this.emitter.broadcastState(this.snapshot());
  }

  /** Settle for the winning TEAM: sign a voucher for every member of that team
   *  (in a free-for-all the "team" is the single survivor). Each member redeems
   *  their own voucher for an equal share of the pot. */
  private async settle(winningTeam: number, reason: GameOverReason): Promise<void> {
    if (this.over || this.settling) return;
    this.settling = true;
    this.stopClock();

    const winnerSeats = this.state.tanks.filter((t) => t.team === winningTeam).map((t) => t.seat);
    const winners = winnerSeats.map((s) => this.seats[s]);
    this.state = { ...this.state, gameOver: true, winner: winnerSeats[0] };

    const vouchers: Record<string, string> = {};
    for (const addr of winners) {
      try {
        const sig = await this.relayer.signResult(this.gameId, addr);
        if (sig) vouchers[addr.toLowerCase()] = sig;
      } catch {
        /* logged by the relayer */
      }
    }
    this.over = { winners, reason, vouchers };
    this.emitter.broadcastOver({ gameId: this.gameId, winners, reason, vouchers });
    this.emitter.broadcastState(this.snapshot());
    this.settling = false;
  }

  /** Mutual KO (all remaining tanks destroyed at once): no winner, no payout
   *  voucher. Stakes stay escrowed for an owner-driven refund. */
  private settleDraw(): void {
    if (this.over) return;
    this.stopClock();
    this.over = { winners: [], reason: "ko" };
    this.emitter.broadcastOver({ gameId: this.gameId, winners: [], reason: "ko" });
    this.emitter.broadcastState(this.snapshot());
  }

  dispose(): void {
    this.stopClock();
  }
}
