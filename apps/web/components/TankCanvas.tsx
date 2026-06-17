"use client";

import { useEffect, useRef } from "react";
import { WORLD_WIDTH, WORLD_HEIGHT, type GameState, type Point } from "@tankdawgs/engine";

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
  trajectories: Point[][];
  impacts: Point[];
}

interface TankCanvasProps {
  state: GameState;
  /** Local player's seat (barrel follows the live aim for this tank). */
  mySeat: number | null;
  /** Live aim for the local tank while choosing a shot. */
  aim?: { angle: number; power: number } | null;
  /** A shot to animate over the (pre-shot) state; calls onAnimationEnd when done. */
  animation?: ShotAnimation | null;
  onAnimationEnd?: () => void;
}

const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];

/** Canvas renderer for the artillery battlefield: terrain, tanks, health bars,
 *  the active barrel, and animated shell trajectories. */
export default function TankCanvas({
  state,
  mySeat,
  aim,
  animation,
  onAnimationEnd,
}: TankCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Keep the latest props in refs so the rAF loop always reads fresh values.
  const stateRef = useRef(state);
  const aimRef = useRef(aim);
  stateRef.current = state;
  aimRef.current = aim;

  // Static (no animation) render — redraws when the state changes.
  useEffect(() => {
    if (animation) return; // the animation effect owns the canvas while it runs
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, canvas, stateRef.current, aimRef.current ?? null, mySeat, null);
  }, [state, aim, mySeat, animation]);

  // Animated render — steps the shell(s) along their trajectories, then ends.
  useEffect(() => {
    if (!animation) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const maxLen = Math.max(1, ...animation.trajectories.map((t) => t.length));
    const STEP_PER_FRAME = Math.max(2, Math.round(maxLen / 90)); // ~1.5s flight
    let idx = 0;

    const tick = () => {
      idx += STEP_PER_FRAME;
      const heads: Point[] = [];
      const trails: Point[][] = [];
      for (const traj of animation.trajectories) {
        const i = Math.min(idx, traj.length - 1);
        heads.push(traj[i]);
        trails.push(traj.slice(0, i + 1));
      }
      const done = idx >= maxLen - 1;
      drawScene(ctx, canvas, stateRef.current, null, mySeat, {
        heads,
        trails,
        impacts: done ? animation.impacts : [],
      });
      if (done) {
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
  heads: Point[];
  trails: Point[][];
  impacts: Point[];
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: GameState,
  aim: { angle: number; power: number } | null,
  mySeat: number | null,
  overlay: Overlay | null
): void {
  const W = canvas.width;
  const H = canvas.height;

  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#243447");
  sky.addColorStop(1, "#3c5063");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Terrain
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 0; x < state.terrain.length; x += 3) ctx.lineTo(x, state.terrain[x]);
  ctx.lineTo(W, state.terrain[state.terrain.length - 1]);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, "#6e7a3a");
  ground.addColorStop(0.5, "#5a6330");
  ground.addColorStop(1, "#3c3f22");
  ctx.fillStyle = ground;
  ctx.fill();
  // Grass lip
  ctx.strokeStyle = "#8a9a47";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, state.terrain[0]);
  for (let x = 0; x < state.terrain.length; x += 3) ctx.lineTo(x, state.terrain[x]);
  ctx.stroke();

  // Tanks
  for (const tank of state.tanks) {
    const tx = tank.x;
    const ty = state.terrain[Math.min(state.terrain.length - 1, Math.max(0, Math.round(tank.x)))];
    const color = seatColor(tank.seat);

    if (!tank.alive) {
      // Wreck — a charred mound.
      ctx.fillStyle = "rgba(20,16,10,0.85)";
      ctx.beginPath();
      ctx.ellipse(tx, ty - 4, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // Barrel — live aim for the local tank, else the tank's last aim.
    const useAim = aim && mySeat === tank.seat ? aim : { angle: tank.angle, power: tank.power };
    const rad = (useAim.angle * Math.PI) / 180;
    const bx = tx + Math.cos(rad) * 26;
    const by = ty - 10 - Math.sin(rad) * 26;
    ctx.strokeStyle = "#1d1d1d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tx, ty - 10);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, tx - 15, ty - 11, 30, 11, 3);
    ctx.fill();
    ctx.stroke();
    // Turret
    ctx.beginPath();
    ctx.arc(tx, ty - 11, 7, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    // Treads
    ctx.fillStyle = "#2a2a2a";
    roundRect(ctx, tx - 17, ty - 4, 34, 6, 3);
    ctx.fill();

    // Health bar
    const hb = 30;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(tx - hb / 2, ty - 30, hb, 5);
    ctx.fillStyle = tank.health > 50 ? "#5ed87a" : tank.health > 20 ? "#e8c33a" : "#e0533a";
    ctx.fillRect(tx - hb / 2, ty - 30, (hb * tank.health) / 100, 5);

    // Turn marker
    if (!state.gameOver && state.turn === tank.seat) {
      ctx.fillStyle = "#f5d76e";
      ctx.beginPath();
      ctx.moveTo(tx, ty - 38);
      ctx.lineTo(tx - 6, ty - 48);
      ctx.lineTo(tx + 6, ty - 48);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Trajectory overlay
  if (overlay) {
    for (const trail of overlay.trails) {
      ctx.strokeStyle = "rgba(255,240,200,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      trail.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const head of overlay.heads) {
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.arc(head.x, head.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const im of overlay.impacts) {
      const burst = ctx.createRadialGradient(im.x, im.y, 2, im.x, im.y, 40);
      burst.addColorStop(0, "rgba(255,220,120,0.95)");
      burst.addColorStop(0.5, "rgba(230,120,40,0.7)");
      burst.addColorStop(1, "rgba(230,120,40,0)");
      ctx.fillStyle = burst;
      ctx.beginPath();
      ctx.arc(im.x, im.y, 40, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { seatColor };
