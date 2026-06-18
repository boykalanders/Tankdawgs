"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import {
  loginMessage,
  TEAM_SIZES,
  type Address,
  type AuthPayload,
  type ClanEvent,
  type NewEventInput,
} from "@tankdawgs/shared";
import WalletGate from "@/components/WalletGate";
import { shortAddress } from "@/lib/format";
import { useClan } from "@/lib/useClan";
import { getSocket } from "@/lib/socket";

export default function EventsPage() {
  return (
    <WalletGate>
      <Events />
    </WalletGate>
  );
}

function localDefault(): string {
  // datetime-local value for "in 1 hour", trimmed to minutes.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Events() {
  const router = useRouter();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { clan } = useClan(address as Address | undefined);

  const [events, setEvents] = useState<ClanEvent[]>([]);
  const [kind, setKind] = useState<"activity" | "challenge">("activity");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"ffa" | "team">("team");
  const [ffaSeats, setFfaSeats] = useState(4);
  const [teamSize, setTeamSize] = useState(2);
  const [stake, setStake] = useState("");
  const [opponent, setOpponent] = useState("");
  const [when, setWhen] = useState(localDefault());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSocket();
    const on = (p: { events: ClanEvent[] }) => setEvents(p.events);
    s.on("events:state", on);
    s.emit("events:subscribe");
    return () => {
      s.off("events:state", on);
      s.emit("events:unsubscribe");
    };
  }, []);

  const auth = useCallback(async (): Promise<AuthPayload | null> => {
    if (!address) return null;
    const ts = Date.now();
    try {
      const signature = await signMessageAsync({ message: loginMessage(address as Address, ts) });
      return { address: address as Address, ts, signature };
    } catch {
      setError("Signature rejected.");
      return null;
    }
  }, [address, signMessageAsync]);

  async function create() {
    setError(null);
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    setBusy(true);
    const a = await auth();
    if (a) {
      const isTeam = format === "team";
      const event: NewEventInput = {
        kind,
        title: title.trim(),
        teamSize: isTeam ? teamSize : 0,
        maxPlayers: isTeam ? teamSize * 2 : ffaSeats,
        opponentClanTag: kind === "challenge" ? opponent.trim().toUpperCase() : undefined,
        stake: stake.trim() || undefined,
        scheduledAt: new Date(when).getTime() || Date.now(),
      };
      getSocket().emit("events:create", { auth: a, event });
      setTitle("");
      setOpponent("");
    }
    setBusy(false);
  }

  const act = useCallback(
    async (ev: "events:rsvp" | "events:launch" | "events:cancel", id: string) => {
      const a = await auth();
      if (a) getSocket().emit(ev, { auth: a, id });
    },
    [auth]
  );

  const fmt = (e: ClanEvent) => (e.teamSize ? `${e.teamSize}v${e.teamSize}` : `${e.maxPlayers}-player FFA`);
  const me = address?.toLowerCase();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl">📅</span>
        <h1 className="heading-display text-3xl">Activities &amp; challenges</h1>
      </div>
      {clan && (
        <p className="text-sm text-cream/60">
          Posting as <span className="font-mono text-gold-bright">[{clan.tag}]</span> {clan.name}
        </p>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {/* Create */}
      <section className="panel panel-gilt space-y-3 p-5">
        <h2 className="heading-display text-xl">Schedule one</h2>
        <div className="grid grid-cols-2 gap-2">
          {(["activity", "challenge"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`rounded-lg border py-2 text-sm font-semibold capitalize transition ${
                kind === k
                  ? "border-gold bg-gold/15 text-gold-bright"
                  : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70 hover:border-gold/60"
              }`}
            >
              {k === "challenge" ? "Clan challenge" : "Open activity"}
            </button>
          ))}
        </div>

        <input
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "challenge" ? "Friday night clan war" : "Casual free-for-all"}
          className="w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
        />

        {kind === "challenge" && (
          <input
            value={opponent}
            maxLength={6}
            onChange={(e) => setOpponent(e.target.value.toUpperCase())}
            placeholder="Opponent clan TAG"
            className="w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 font-mono uppercase outline-none focus:border-gold"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFormat("team")}
            aria-pressed={format === "team"}
            className={`rounded-lg border py-2 text-sm font-semibold transition ${
              format === "team" ? "border-gold bg-gold/15 text-gold-bright" : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70"
            }`}
          >
            Teams
          </button>
          <button
            type="button"
            onClick={() => setFormat("ffa")}
            aria-pressed={format === "ffa"}
            className={`rounded-lg border py-2 text-sm font-semibold transition ${
              format === "ffa" ? "border-gold bg-gold/15 text-gold-bright" : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70"
            }`}
          >
            Free-for-all
          </button>
        </div>

        {format === "team" ? (
          <div className="grid grid-cols-3 gap-2">
            {TEAM_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTeamSize(s)}
                aria-pressed={teamSize === s}
                className={`rounded-lg border py-2 text-sm font-semibold transition ${
                  teamSize === s ? "border-gold bg-gold/15 text-gold-bright" : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70"
                }`}
              >
                {s}v{s}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="number"
            min={2}
            max={8}
            value={ffaSeats}
            onChange={(e) => setFfaSeats(Math.max(2, Math.min(8, Number(e.target.value) || 2)))}
            className="w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-cream/55">
            When
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
            />
          </label>
          <label className="text-xs text-cream/55">
            Stake $DDawgs (optional)
            <input
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              inputMode="decimal"
              placeholder="100"
              className="mt-1 w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
            />
          </label>
        </div>

        <button className="btn-gold w-full" disabled={busy} onClick={create}>
          {busy ? "Signing…" : "Post it"}
        </button>
      </section>

      {/* List */}
      <section className="space-y-3">
        <h2 className="heading-display text-xl">Upcoming</h2>
        {events.length === 0 ? (
          <div className="panel p-8 text-center text-cream/50">Nothing scheduled — post the first.</div>
        ) : (
          events.map((e) => {
            const mine = me && e.host.toLowerCase() === me;
            const going = !!me && e.rsvps.some((r) => r.toLowerCase() === me);
            return (
              <div key={e.id} className="panel flex flex-wrap items-center gap-3 px-5 py-4">
                <span className="text-2xl">{e.kind === "challenge" ? "⚔️" : "🎯"}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-amber-50">
                    {e.title}
                    {e.opponentClanTag && (
                      <span className="ml-2 font-mono text-xs text-gold-bright">vs [{e.opponentClanTag}]</span>
                    )}
                  </p>
                  <p className="text-xs text-cream/60">
                    {fmt(e)} · {e.stake ? `${e.stake} $DDawgs · ` : ""}
                    {new Date(e.scheduledAt).toLocaleString()} · {e.rsvps.length} in ·{" "}
                    {e.hostName?.trim() || shortAddress(e.host)}
                  </p>
                </div>
                {e.gameCode ? (
                  <button className="btn-gold" onClick={() => router.push(`/game/${e.gameCode}`)}>
                    Open match
                  </button>
                ) : (
                  <button
                    className={going ? "btn-gold" : "btn-outline"}
                    onClick={() => act("events:rsvp", e.id)}
                  >
                    {going ? "Going ✓" : "RSVP"}
                  </button>
                )}
                {mine && !e.gameCode && (
                  <button className="btn-outline" onClick={() => act("events:launch", e.id)}>
                    Launch
                  </button>
                )}
                {mine && (
                  <button
                    className="btn-outline border-red-900/60 text-red-300 hover:border-red-500"
                    onClick={() => act("events:cancel", e.id)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
