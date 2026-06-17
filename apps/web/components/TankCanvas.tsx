"use client";

import { useEffect, useRef } from "react";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  weaponById,
  type GameState,
  type Point,
  type Shell,
} from "@tankdawgs/engine";
import { playBoom, playFire } from "@/lib/sound";

/** Per-seat tank colours (battlefield palette). */
const SEAT_COLORS = [
  "#d8b24a", // gold
  "#4a9bd8", // steel blue
  "#d85a4a", // rust red
  "#5ed87a", // olive green
  "#c14ad8", // violet
  "#d8884a", // orange
  "#4ad8c1", // teal
  "#d84a9b", // magenta
];

export interface ShotAnimation {
  shells: Shell[];
}

interface TankCanvasProps {
  state: GameState;
  mySeat: number | null;
  aim?: { angle: number; power: number } | null;
  animation?: ShotAnimation | null;
  muted?: boolean;
  onAnimationEnd?: () => void;
}

const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];

interface Burst {
  x: number;
  y: number;
  color: string;
  radius: number;
  born: number; // frame index when it started
}

/** Canvas renderer for the artillery battlefield: terrain, luxe tanks, health
 *  bars, the active barrel, and staged per-weapon shell trajectories. */
export default function TankCanvas({ state, mySeat, aim, animation, muted, onAnimationEnd }: TankCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  const aimRef = useRef(aim);
  const mutedRef = useRef(muted);
  stateRef.current = state;
  aimRef.current = aim;
  mutedRef.current = muted;

  // Static render — when no shot is animating.
  useEffect(() => {
    if (animation) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawScene(ctx, canvas, stateRef.current, aimRef.current ?? null, mySeat, { heads: [], trails: [], bursts: [], recoil: 0 });
  }, [state, aim, mySeat, animation]);

  // Animated render — steps every shell along its (staged) path, fires muzzle
  // flash + recoil, and blooms a per-weapon explosion at each impact.
  useEffect(() => {
    if (!animation) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const shells = animation.shells;
    const lastSimStep = Math.max(1, ...shells.map((s) => s.startStep + s.path.length));
    const stepPerFrame = Math.max(2, Math.round(lastSimStep / 100)); // ~1.5–2s flight
    const FADE = 26; // explosion fade in frames
    const bursts: Burst[] = [];
    const burstFired = new Set<number>();
    let frame = 0;
    if (!mutedRef.current) playFire(); // cannon report at launch

    const tick = () => {
      frame += 1;
      const simStep = frame * stepPerFrame;
      const heads: { p: Point; color: string; r: number }[] = [];
      const trails: { pts: Point[]; color: string }[] = [];

      shells.forEach((shell, i) => {
        if (simStep < shell.startStep) return; // not launched yet
        const w = weaponById(shell.weaponId);
        const local = simStep - shell.startStep;
        const head = Math.min(local, shell.path.length - 1);
        trails.push({ pts: shell.path.slice(0, head + 1), color: w.style.trail });
        if (local < shell.path.length - 1) {
          heads.push({ p: shell.path[head], color: w.style.shell, r: w.style.shellRadius });
        } else if (shell.impact && !burstFired.has(i)) {
          burstFired.add(i);
          bursts.push({ x: shell.impact.x, y: shell.impact.y, color: w.style.burst, radius: w.blastRadius, born: frame });
          if (!mutedRef.current) playBoom(w.blastRadius);
        }
      });

      const live = bursts.filter((b) => frame - b.born < FADE);
      const recoil = Math.max(0, 1 - frame / 7); // 0..1 over the first ~7 frames

      drawScene(ctx, canvas, stateRef.current, null, mySeat, {
        heads,
        trails,
        bursts: live.map((b) => ({ ...b, age: (frame - b.born) / FADE })),
        recoil,
      });

      const flying = shells.some((s) => simStep < s.startStep + s.path.length - 1);
      if (!flying && live.length === 0) {
        rafRef.current = null;
        onAnimationEnd?.();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation]);

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_WIDTH}
      height={WORLD_HEIGHT}
      className="h-auto w-full rounded-lg"
      style={{ aspectRatio: `${WORLD_WIDTH} / ${WORLD_HEIGHT}` }}
    />
  );
}

interface Overlay {
  heads: { p: Point; color: string; r: number }[];
  trails: { pts: Point[]; color: string }[];
  bursts: { x: number; y: number; color: string; radius: number; age?: number }[];
  /** 0 = at rest, 1 = full recoil (applied to the seat on turn). */
  recoil: number;
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: GameState,
  aim: { angle: number; power: number } | null,
  mySeat: number | null,
  overlay: Overlay
): void {
  const W = canvas.width;
  const H = canvas.height;

  // Sky with a soft sun glow.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#1b2733");
  sky.addColorStop(0.6, "#33485c");
  sky.addColorStop(1, "#46607a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.78, H * 0.2, 10, W * 0.78, H * 0.2, 260);
  sun.addColorStop(0, "rgba(255,236,180,0.35)");
  sun.addColorStop(1, "rgba(255,236,180,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  // Terrain.
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 0; x < state.terrain.length; x += 3) ctx.lineTo(x, state.terrain[x]);
  ctx.lineTo(W, state.terrain[state.terrain.length - 1]);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, "#6e7a3a");
  ground.addColorStop(0.5, "#55602e");
  ground.addColorStop(1, "#3a3d20");
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.strokeStyle = "#9caa52";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 0; x < state.terrain.length; x += 3) ctx.lineTo(x, state.terrain[x]);
  ctx.stroke();

  // Tanks.
  for (const tank of state.tanks) {
    const surfX = Math.min(state.terrain.length - 1, Math.max(0, Math.round(tank.x)));
    const ty = state.terrain[surfX];
    const onTurn = !state.gameOver && state.turn === tank.seat;
    const useAim = aim && mySeat === tank.seat ? aim : { angle: tank.angle, power: tank.power };
    drawTank(ctx, tank.x, ty, tank.seat, useAim.angle, tank.alive, tank.health, onTurn, onTurn ? overlay.recoil : 0);
    // Wind read-out above the tank whose turn it is.
    if (onTurn && tank.alive) drawWindTag(ctx, tank.x, Math.max(16, ty - 66), state.wind);
  }

  // Shell trails + heads.
  for (const t of overlay.trails) {
    if (t.pts.length < 2) continue;
    ctx.strokeStyle = t.color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    t.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const h of overlay.heads) {
    const glow = ctx.createRadialGradient(h.p.x, h.p.y, 0, h.p.x, h.p.y, h.r * 3);
    glow.addColorStop(0, h.color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(h.p.x, h.p.y, h.r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(h.p.x, h.p.y, h.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Explosions.
  for (const b of overlay.bursts) {
    const age = b.age ?? 0;
    const r = b.radius * (0.4 + age * 0.9);
    ctx.globalAlpha = 1 - age;
    const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.4, b.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** A polished tank: shadow, road-wheels, beveled hull with gold trim, domed
 *  turret, tapered barrel with a muzzle brake, and a seat-colour pennant. */
function drawTank(
  ctx: CanvasRenderingContext2D,
  x: number,
  surfaceY: number,
  seat: number,
  angleDeg: number,
  alive: boolean,
  health: number,
  onTurn: boolean,
  recoil: number
): void {
  const color = seatColor(seat);
  const baseY = surfaceY;

  if (!alive) {
    ctx.fillStyle = "rgba(15,12,8,0.9)";
    ctx.beginPath();
    ctx.ellipse(x, baseY - 4, 17, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(80,70,55,0.6)";
    ctx.fillRect(x - 3, baseY - 16, 2, 12);
    ctx.fillRect(x + 4, baseY - 13, 2, 9);
    return;
  }

  // Recoil shifts the whole tank opposite the barrel.
  const rad = (angleDeg * Math.PI) / 180;
  const cx = x - Math.cos(rad) * 6 * recoil;
  const cy = baseY;

  // Ground shadow.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, 20, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Barrel (under turret) — tapered with a muzzle brake.
  const bx = cx + Math.cos(rad) * 30;
  const by = cy - 13 - Math.sin(rad) * 30;
  ctx.strokeStyle = "#15181c";
  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = "#3a4048";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.fillStyle = "#0e1014";
  ctx.beginPath();
  ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Treads + road wheels.
  ctx.fillStyle = "#202329";
  roundRect(ctx, cx - 19, cy - 5, 38, 8, 4);
  ctx.fill();
  ctx.fillStyle = "#3a3f47";
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(cx + i * 8, cy - 1, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hull — beveled gradient with gold trim.
  const hull = ctx.createLinearGradient(0, cy - 14, 0, cy - 4);
  hull.addColorStop(0, lighten(color, 0.35));
  hull.addColorStop(1, darken(color, 0.25));
  ctx.fillStyle = hull;
  roundRect(ctx, cx - 16, cy - 13, 32, 10, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,197,71,0.7)"; // gold trim
  ctx.lineWidth = 1;
  ctx.stroke();
  // top highlight
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy - 12);
  ctx.lineTo(cx + 12, cy - 12);
  ctx.stroke();

  // Turret dome with a gold hatch ring.
  const dome = ctx.createLinearGradient(0, cy - 22, 0, cy - 11);
  dome.addColorStop(0, lighten(color, 0.45));
  dome.addColorStop(1, darken(color, 0.1));
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(cx, cy - 12, 8, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,197,71,0.85)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy - 12, 4, Math.PI, 0);
  ctx.stroke();

  // Pennant on a thin antenna.
  ctx.strokeStyle = "#cfd6df";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy - 14);
  ctx.lineTo(cx - 15, cy - 28);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy - 28);
  ctx.lineTo(cx - 8, cy - 26);
  ctx.lineTo(cx - 15, cy - 23);
  ctx.closePath();
  ctx.fill();

  // Health bar.
  const hb = 30;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  roundRect(ctx, cx - hb / 2, cy - 38, hb, 5, 2);
  ctx.fill();
  ctx.fillStyle = health > 50 ? "#5ed87a" : health > 20 ? "#e8c33a" : "#e0533a";
  roundRect(ctx, cx - hb / 2, cy - 38, (hb * Math.max(0, health)) / 100, 5, 2);
  ctx.fill();

  // Turn marker.
  if (onTurn) {
    ctx.fillStyle = "#f5d76e";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 44);
    ctx.lineTo(cx - 6, cy - 54);
    ctx.lineTo(cx + 6, cy - 54);
    ctx.closePath();
    ctx.fill();
  }

  // Muzzle flash during recoil.
  if (recoil > 0.25) {
    const fr = 10 * recoil;
    const fg = ctx.createRadialGradient(bx, by, 0, bx, by, fr);
    fg.addColorStop(0, "rgba(255,245,200,0.95)");
    fg.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(bx, by, fr, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Wind banner drawn above the active tank — direction arrow + strength. */
function drawWindTag(ctx: CanvasRenderingContext2D, x: number, y: number, wind: number): void {
  const pct = Math.round(Math.abs(wind) * 100);
  const txt = wind === 0 ? "WIND  CALM" : `WIND  ${wind > 0 ? "▶" : "◀"} ${pct}`;
  ctx.font = "bold 15px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + 18;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  roundRect(ctx, x - w / 2, y - 11, w, 22, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(232,197,71,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = pct >= 60 ? "#ff8c5a" : "#e8c547";
  ctx.fillText(txt, x, y);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function shade(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${clampByte(r + r * f)},${clampByte(g + g * f)},${clampByte(b + b * f)})`;
}
const lighten = (hex: string, f: number) => shade(hex, f);
const darken = (hex: string, f: number) => shade(hex, -f);

export { seatColor };
