"use client";

import { seatColor } from "@/components/TankCanvas";

export interface ShellPlayer {
  seat: number;
  name: string;
  detail?: string;
  avatarSrc?: string;
  connected?: boolean;
}

interface PlayerCardProps {
  player: ShellPlayer;
  health: number;
  alive: boolean;
  isTurn: boolean;
}

/** Compact roster card: avatar, name, seat colour, a health bar and a turn glow. */
export default function PlayerCard({ player, health, alive, isTurn }: PlayerCardProps) {
  const color = seatColor(player.seat);
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition ${
        isTurn ? "border-red-500 shadow-[0_0_12px_rgba(220,38,38,0.5)]" : "border-gold-dim/30 bg-emerald-panel/50"
      } ${!alive ? "opacity-50" : ""}`}
    >
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border-2" style={{ borderColor: color }}>
        {player.avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.avatarSrc} alt={player.name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-wood-grain text-lg">🐶</span>
        )}
        {!alive && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm">💀</span>
        )}
        {!player.connected && alive && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-emerald-deep bg-red-500" />
        )}
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-xs font-bold text-amber-50">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          {player.name}
        </p>
        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-black/50">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.max(0, health)}%`,
              background: health > 50 ? "#5ed87a" : health > 20 ? "#e8c33a" : "#e0533a",
            }}
          />
        </div>
        {player.detail && <p className="mt-0.5 truncate text-[10px] text-gold-bright/80">{player.detail}</p>}
      </div>
    </div>
  );
}
