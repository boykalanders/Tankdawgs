"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
  WEAPON_LIST,
  DEFAULT_WEAPON,
  weaponById,
  type GameState,
  type ShotInput,
} from "@tankdawgs/engine";
import type { ChatMessage } from "@tankdawgs/shared";
import Chat from "@/components/Chat";
import PlayerCard, { type ShellPlayer } from "@/components/PlayerCard";
import TankCanvas, { type ShotAnimation } from "@/components/TankCanvas";
import {
  IconChat,
  IconGift,
  IconHome,
  IconMenu,
  IconSoundOff,
  IconSoundOn,
  IconTrophy,
  IconWallet,
} from "@/components/icons";

export type { ShellPlayer } from "@/components/PlayerCard";

export interface ShellMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface GameShellProps {
  state: GameState;
  players: ShellPlayer[];
  mySeat: number | null;
  interactive: boolean;
  potLabel?: string | null;
  balanceLabel?: string | null;
  clockExpiresAt?: number | null;
  statusText: string;
  banner?: string | null;
  menuItems: ShellMenuItem[];
  animation?: ShotAnimation | null;
  onFire: (shot: ShotInput) => void;
  /** Drive the player's tank one step (dir −1 = west, +1 = east). */
  onDrive?: (dir: number) => void;
  onAnimationEnd: () => void;
  chat?: {
    messages: ChatMessage[];
    myAddress: string | null;
    onSend: (text: string) => void;
  };
  overlay?: ReactNode;
}

/** Full artillery chrome: player frames, the battlefield canvas, aim/power/
 *  weapon controls, a wind gauge, turn clock and chat. */
export default function GameShell({
  state,
  players,
  mySeat,
  interactive,
  potLabel,
  balanceLabel,
  clockExpiresAt,
  statusText,
  banner,
  menuItems,
  animation,
  onFire,
  onDrive,
  onAnimationEnd,
  chat,
  overlay,
}: GameShellProps) {
  const [angle, setAngle] = useState(50);
  const [power, setPower] = useState(55);
  const [weaponId, setWeaponId] = useState<string>(DEFAULT_WEAPON);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const seenCount = useRef(0);

  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { isConnected } = useAccount();

  // Seed the controls from my tank's last aim when it becomes my turn.
  useEffect(() => {
    if (mySeat == null) return;
    const me = state.tanks[mySeat];
    if (me) {
      setAngle(me.angle);
      setPower(me.power);
    }
  }, [mySeat, state.turn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const count = chat?.messages.length ?? 0;
    if (chatOpen) {
      seenCount.current = count;
      setUnread(0);
    } else if (count > seenCount.current) {
      setUnread(count - seenCount.current);
    }
  }, [chat?.messages.length, chatOpen]);

  // Remaining ammo for the seat that's firing (the Shell is unlimited).
  const myAmmo = mySeat != null ? state.ammo?.[mySeat] : undefined;
  const ammoLeft = (w: { id: string; ammo?: number }) =>
    w.ammo == null ? null : myAmmo?.[w.id] ?? w.ammo;

  // If the chosen weapon runs dry, fall back to the unlimited Shell.
  useEffect(() => {
    const w = weaponById(weaponId);
    if (w.ammo != null && (myAmmo?.[w.id] ?? w.ammo) <= 0) setWeaponId(DEFAULT_WEAPON);
  }, [weaponId, myAmmo]);

  function fire() {
    if (!interactive) return;
    const left = ammoLeft(weaponById(weaponId));
    if (left != null && left <= 0) return; // out of ammo
    onFire({ angle, power, weaponId });
  }

  return (
    <>
      <div className="relative mx-auto flex min-h-[560px] w-full max-w-[1180px] flex-col gap-2 rounded-3xl border border-gold-dim/40 bg-emerald-deep/85 p-3 shadow-2xl shadow-felt-inset">
        {/* ── header: config · ½ players · badge · ½ players · wind · chat ── */}
        <header className="flex min-h-[68px] items-center gap-3 rounded-2xl border border-gold-dim/25 bg-gradient-to-b from-black/45 to-black/15 px-3 py-2 shadow-inner">
          <div className="relative shrink-0">
            <IconButton icon={<IconMenu />} active={menuOpen} onClick={() => setMenuOpen((v) => !v)} title="Config" />
            {menuOpen && (
              <div className="absolute left-0 top-[3.25rem] z-30 w-56 overflow-hidden rounded-xl border border-gold-dim/40 bg-emerald-panel shadow-2xl">
                <button
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-cream transition hover:bg-gold/10"
                  onClick={() => {
                    setMenuOpen(false);
                    setMuted((v) => !v);
                  }}
                >
                  {muted ? <IconSoundOff className="h-4 w-4" /> : <IconSoundOn className="h-4 w-4" />}
                  {muted ? "Sound: off" : "Sound: on"}
                </button>
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-gold/10 ${
                      item.danger ? "text-red-300 hover:bg-red-500/10" : "text-cream"
                    }`}
                    onClick={() => {
                      setMenuOpen(false);
                      item.onClick();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* left half of the roster — hugs the config side */}
          <div className="flex flex-1 flex-wrap items-center justify-start gap-2">
            {players.slice(0, Math.ceil(players.length / 2)).map((p) => (
              <PlayerCard
                key={p.seat}
                player={p}
                health={state.tanks[p.seat]?.health ?? 0}
                alive={state.tanks[p.seat]?.alive ?? false}
                isTurn={!state.gameOver && state.turn === p.seat}
                colorIndex={state.teamSize > 0 ? state.tanks[p.seat]?.team ?? p.seat : p.seat}
              />
            ))}
          </div>

          {/* center badge */}
          <div className="relative flex shrink-0 items-center justify-center px-2">
            <div className="absolute inset-0 -z-0 bg-[radial-gradient(ellipse_at_center,rgba(232,197,71,0.12),transparent_70%)]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/logo.svg"
              alt="Tank Dawgs"
              className="pointer-events-none relative h-14 w-auto drop-shadow-[0_4px_14px_rgba(0,0,0,0.85)]"
              draggable={false}
            />
          </div>

          {/* right half of the roster — hugs the wind/chat side */}
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {players.slice(Math.ceil(players.length / 2)).map((p) => (
              <PlayerCard
                key={p.seat}
                player={p}
                health={state.tanks[p.seat]?.health ?? 0}
                alive={state.tanks[p.seat]?.alive ?? false}
                isTurn={!state.gameOver && state.turn === p.seat}
                colorIndex={state.teamSize > 0 ? state.tanks[p.seat]?.team ?? p.seat : p.seat}
              />
            ))}
          </div>

          <Divider />

          <div className="relative shrink-0">
            <IconButton icon={<IconChat />} active={chatOpen} onClick={() => setChatOpen((v) => !v)} disabled={!chat} title="Comms" />
            {unread > 0 && !chatOpen && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-emerald-deep bg-burn px-1 text-[10px] font-bold text-white shadow">
                {unread}
              </span>
            )}
          </div>
        </header>

        {/* ── battlefield ── */}
        <div className="relative">
          <TankCanvas
            state={state}
            mySeat={mySeat}
            aim={interactive ? { angle, power } : null}
            animation={animation}
            muted={muted}
            onAnimationEnd={onAnimationEnd}
          />
          {clockExpiresAt != null && !state.gameOver && (
            <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2">
              <TurnClock expiresAt={clockExpiresAt} />
            </div>
          )}
          {banner && (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-gold/60 bg-black/80 px-4 py-1.5 text-sm text-gold-bright shadow-gold-glow">
              {banner}
            </div>
          )}
          {overlay && (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/60">{overlay}</div>
          )}
        </div>

        {/* ── controls ── */}
        <div className="space-y-3 rounded-xl border border-gold-dim/30 bg-emerald-panel/60 p-3">
          {/* Themed weapon picker */}
          <div>
            <span className="mb-1.5 block text-[10px] uppercase tracking-widest text-cream/50">Weapon</span>
            <div className="flex flex-wrap gap-1.5">
              {WEAPON_LIST.map((w) => {
                const active = w.id === weaponId;
                const left = ammoLeft(w);
                const depleted = left != null && left <= 0;
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={!interactive || depleted}
                    onClick={() => setWeaponId(w.id)}
                    title={depleted ? `${w.name} — out of ammo` : w.blurb}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      depleted ? "line-through" : ""
                    } ${
                      active
                        ? "border-gold bg-gold/15 text-gold-bright shadow-gold-glow"
                        : "border-gold-dim/30 bg-mahogany-deep text-cream/70 enabled:hover:border-gold/60 enabled:hover:text-gold-bright"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: w.style.shell }} />
                    {w.name}
                    <span
                      className={`ml-0.5 tabular-nums text-[10px] font-bold ${
                        left == null ? "text-cream/35" : depleted ? "text-cream/35" : "text-gold-bright/85"
                      }`}
                    >
                      {left == null ? "∞" : `×${left}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] italic text-cream/45">{weaponById(weaponId).blurb}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Slider label="Angle" value={angle} min={0} max={180} suffix="°" disabled={!interactive} onChange={setAngle} />
            <Slider label="Power" value={power} min={1} max={100} suffix="%" disabled={!interactive} onChange={setPower} />
            <div className="flex items-end gap-2">
              {/* Drive controls — up to MOVES_PER_TURN steps before firing. */}
              <div className="flex flex-col items-center">
                <span className="mb-1 text-[10px] uppercase tracking-widest text-cream/50">
                  Drive · {state.movesLeft}
                </span>
                <div className="flex gap-1">
                  <DriveButton dir={-1} disabled={!interactive || state.movesLeft <= 0 || !onDrive} onClick={() => onDrive?.(-1)} />
                  <DriveButton dir={1} disabled={!interactive || state.movesLeft <= 0 || !onDrive} onClick={() => onDrive?.(1)} />
                </div>
              </div>
              <button
                onClick={fire}
                disabled={!interactive}
                className="h-[42px] rounded-lg border-2 border-gold bg-gold/20 px-6 font-display text-lg font-extrabold tracking-widest text-gold-bright shadow-gold-glow transition enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:border-gold/30 disabled:text-cream/40 disabled:shadow-none"
              >
                FIRE
              </button>
            </div>
          </div>
        </div>

        {/* ── status + money ── */}
        <div className="flex items-center gap-3">
          <MoneyPanel title="$DDAWGS" value={balanceLabel ?? "—"} />
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <span className="truncate rounded-lg border border-gold/40 bg-black/50 px-4 py-1.5 text-center font-display text-sm font-bold tracking-widest text-gold-bright">
              {statusText}
            </span>
          </div>
          <MoneyPanel title="Pot" value={potLabel ?? "—"} />
        </div>

        {/* ── bottom nav (touch only) ── */}
        <nav className="mt-1 flex items-end justify-around border-t border-gold-dim/20 px-2 pt-2 text-[10px] uppercase tracking-[0.12em] text-cream/65 desktop:hidden">
          <NavItem href="/lobby" icon={<IconHome className="h-5 w-5" />} label="Lobby" />
          <NavItem href="/leaderboard" icon={<IconTrophy className="h-5 w-5" />} label="Ranks" />
          <NavItem icon={<IconGift className="h-5 w-5" />} label="Rewards" disabled title="Coming soon" />
          <NavItem
            icon={<IconWallet className="h-5 w-5" />}
            label="Wallet"
            onClick={() => (isConnected ? openAccountModal?.() : openConnectModal?.())}
          />
        </nav>
      </div>

      {chat && (
        <>
          {chatOpen && (
            <button
              aria-label="Close chat"
              onClick={() => setChatOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm desktop:hidden"
            />
          )}
          <aside
            className={`fixed right-0 top-0 bottom-0 z-50 flex w-[min(20rem,88vw)] flex-col p-2 transition-transform duration-200 ease-out desktop:top-[4.25rem] desktop:bottom-4 ${
              chatOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
            }`}
          >
            <Chat messages={chat.messages} myAddress={chat.myAddress} onSend={chat.onSend} onClose={() => setChatOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

/** Thin vertical separator between header zones. */
function Divider() {
  return <span className="hidden h-10 w-px shrink-0 bg-gold-dim/25 sm:block" />;
}

function DriveButton({ dir, disabled, onClick }: { dir: number; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={dir < 0 ? "Drive west" : "Drive east"}
      className="flex h-[34px] w-9 items-center justify-center rounded-lg border border-gold-dim/40 bg-mahogany-deep text-base text-cream/80 transition enabled:hover:border-gold/60 enabled:hover:text-gold-bright disabled:cursor-not-allowed disabled:opacity-40"
    >
      {dir < 0 ? "◀" : "▶"}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-cream/50">
        {label}
        <span className="font-mono text-sm font-bold text-gold-bright">
          {Math.round(value)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold disabled:opacity-50"
      />
    </label>
  );
}

function TurnClock({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    setRemaining(Math.max(0, expiresAt - Date.now()));
    const t = setInterval(() => setRemaining(Math.max(0, expiresAt - Date.now())), 200);
    return () => clearInterval(t);
  }, [expiresAt]);
  const secs = Math.ceil(remaining / 1000);
  const urgent = secs <= 10;
  return (
    <div
      className={`rounded-full border bg-black/80 font-mono font-bold tabular-nums shadow transition-all ${
        urgent
          ? "animate-pulse border-red-500 px-5 py-2 text-2xl text-red-400 shadow-[0_0_16px_rgba(220,38,38,0.7)]"
          : "border-gold/60 px-3.5 py-1 text-sm text-gold-bright"
      }`}
    >
      {secs}
    </div>
  );
}

function NavItem({
  href,
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const inner = (
    <span className={`flex flex-col items-center gap-1 px-2 transition ${disabled ? "cursor-not-allowed opacity-45" : "hover:text-gold-bright"}`}>
      {icon}
      {label}
    </span>
  );
  if (href && !disabled)
    return (
      <Link href={href} className="contents">
        {inner}
      </Link>
    );
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} title={title}>
      {inner}
    </button>
  );
}

const railBase = "flex items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40";
const railTone = (active?: boolean) =>
  active
    ? "border-gold/80 bg-gold/10 text-gold-bright shadow-gold-glow"
    : "border-gold-dim/30 bg-emerald-panel/60 text-cream/75 enabled:hover:border-gold/60 enabled:hover:bg-gold/5 enabled:hover:text-gold-bright";

function IconButton({ icon, onClick, disabled, active, title }: { icon: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${railBase} h-11 w-11 ${railTone(active)}`}>
      {icon}
    </button>
  );
}

function MoneyPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gold-dim/30 bg-emerald-panel/60 px-3.5 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/token.svg" alt="" className="h-6 w-6" draggable={false} />
      <div className="leading-tight">
        <p className="text-[9px] uppercase tracking-[0.14em] text-cream/45">{title}</p>
        <p className="font-mono text-sm font-semibold text-gold-bright">{value}</p>
      </div>
    </div>
  );
}
