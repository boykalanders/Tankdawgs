import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  newGameCode,
  newTeamGameCode,
  MAX_EVENT_TITLE,
  type Address,
  type ClanEvent,
  type NewEventInput,
} from "@tankdawgs/shared";

/**
 * In-memory store of scheduled clan activities + inter-clan challenges, with
 * best-effort JSON persistence (same pattern as the profile/lobby stores). This
 * is the off-chain coordination layer that references the on-chain clans:
 * scheduling, RSVPs, and minting a game code when the host launches.
 */
export class EventStore {
  private events = new Map<string, ClanEvent>();
  private listeners = new Set<() => void>();
  private seq = 0;
  private readonly file: string;

  constructor(dataDir?: string) {
    this.file = join(dataDir || process.cwd(), "events.json");
    this.load();
  }

  /** Upcoming + recently-launched events, soonest first. Prunes stale ones. */
  list(): ClanEvent[] {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000; // drop events >6h past
    let changed = false;
    for (const [id, e] of this.events) {
      if (e.scheduledAt < cutoff && !e.gameCode) {
        this.events.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
    return [...this.events.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  create(host: Address, input: NewEventInput): ClanEvent | null {
    const title = String(input.title ?? "").trim().slice(0, MAX_EVENT_TITLE);
    if (!title) return null;
    const teamSize = [2, 3, 4].includes(input.teamSize) ? input.teamSize : 0;
    const maxPlayers = teamSize ? teamSize * 2 : Math.max(2, Math.min(8, Math.round(input.maxPlayers || 2)));
    const id = `evt_${Date.now().toString(36)}_${(this.seq++).toString(36)}`;
    const event: ClanEvent = {
      id,
      kind: input.kind === "challenge" ? "challenge" : "activity",
      title,
      host: host.toLowerCase() as Address,
      teamSize,
      maxPlayers,
      opponentClanTag: input.opponentClanTag?.trim().toUpperCase().slice(0, 6) || null,
      stake: input.stake?.trim() || undefined,
      scheduledAt: Number(input.scheduledAt) || Date.now(),
      rsvps: [host.toLowerCase() as Address],
      createdAt: Date.now(),
    };
    this.events.set(id, event);
    this.persist();
    this.notify();
    return event;
  }

  /** Toggle a player's RSVP. */
  rsvp(id: string, addr: Address): void {
    const e = this.events.get(id);
    if (!e) return;
    const key = addr.toLowerCase() as Address;
    e.rsvps = e.rsvps.includes(key) ? e.rsvps.filter((a) => a !== key) : [...e.rsvps, key];
    this.persist();
    this.notify();
  }

  /** Host mints a game code so participants can play. Idempotent. */
  launch(id: string, host: Address): void {
    const e = this.events.get(id);
    if (!e || e.host !== host.toLowerCase()) return;
    if (!e.gameCode) {
      e.gameCode = e.teamSize ? newTeamGameCode(e.teamSize) : newGameCode(e.maxPlayers);
      this.persist();
      this.notify();
    }
  }

  cancel(id: string, host: Address): void {
    const e = this.events.get(id);
    if (!e || e.host !== host.toLowerCase()) return;
    this.events.delete(id);
    this.persist();
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const data = JSON.parse(readFileSync(this.file, "utf8")) as ClanEvent[];
      for (const e of data) if (e?.id) this.events.set(e.id, e);
    } catch (e) {
      console.error("[events] could not load:", e instanceof Error ? e.message : e);
    }
  }

  private persist(): void {
    try {
      mkdirSync(join(this.file, ".."), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.events.values()], null, 2));
    } catch (e) {
      console.error("[events] could not persist:", e instanceof Error ? e.message : e);
    }
  }
}
