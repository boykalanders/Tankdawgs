"use client";

import { useEffect, useRef } from "react";
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  weaponById,
  type GameState,
  type Point,
  type Shell,
  type Weapon,
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
  /** Authoritative post-shot state. The renderer diffs it against the live
   *  (pre-shot) `state` to drive damage numbers, health drain and knockback as
   *  each blast lands — no extra data needs to flow from the server. */
  endState?: GameState;
}

interface TankCanvasProps {
  state: GameState;
  mySeat: number | null;
  aim?: { angle: number; power: number } | null;
  animation?: ShotAnimation | null;
  muted?: boolean;
  onAnimationEnd?: () => void;
}

/** How fast a driving tank rolls, in world units per frame (~60fps). Low =
 *  slow, deliberate tread movement. */
const DRIVE_SPEED = 1.4;
/** Half-height of a tank body — must match the engine's TANK_BODY so blast
 *  overlap is judged against the same hit centre. */
const TANK_BODY = 8;
/** Knockback slide speed (world-units/frame) when a tank is shoved by a blast. */
const KNOCK_SPEED = 2.6;
const DRAIN_FRAMES = 12; // frames over which a hit drains the health bar
const JOLT_FRAMES = 14; // frames of the upward jolt after a hit
const JOLT_RISE = 6; // peak jolt height (px)
const POPUP_FRAMES = 34; // lifetime of a floating damage number

const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];

interface Burst {
  x: number;
  y: number;
  color: string;
  radius: number;
  born: number; // frame index when it started
}

/** A flying debris/spark/smoke particle thrown by an explosion. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grav: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number; // size change per frame (smoke billows)
  color: string;
  shape: "chunk" | "spark" | "smoke";
}

/** An expanding shockwave ring; render state is derived from its age. */
interface ShockSrc {
  x: number;
  y: number;
  born: number;
  maxR: number;
  life: number;
  color: string;
  width: number;
}

/** A patch of fire that keeps burning after a Napalm impact. */
interface Flame {
  x: number;
  y: number;
  born: number;
  life: number;
}

type ShellShape = "round" | "shell" | "heavy" | "dart" | "drill" | "warhead" | "piston";
type TrailStyle = "line" | "glow" | "smoke" | "spark" | "ember";

/** A shell in flight — position, colour, size, silhouette and heading. */
interface Head {
  p: Point;
  color: string;
  r: number;
  shape: ShellShape;
  angle: number; // travel direction (radians)
}

const LINGER_FRAMES = 72; // how long Napalm flames keep burning (~1.2s)

/** Spawn an explosion's particles + shockwave for a weapon's FX flavour. Pushes
 *  into the live arrays and returns a screen-flash amount (0 = none). Particle
 *  counts scale with the weapon's blast radius, so a bigger affect range reads
 *  as a visibly bigger explosion. Renderer-only — uses Math.random freely. */
function spawnExplosion(
  ex: number,
  ey: number,
  w: Weapon,
  frame: number,
  particles: Particle[],
  shocks: ShockSrc[]
): number {
  const R = w.blastRadius;
  const fx = w.style.fx ?? "blast";
  const smoke = w.style.smoke ?? "#5a544a";
  const burst = w.style.burst;
  const shell = w.style.shell;
  const r = Math.random;
  const dens = R / 34; // particle density scales with the blast's affect range
  let flash = 0;

  const ring = (mult: number, life: number, color: string, width: number) =>
    shocks.push({ x: ex, y: ey, born: frame, maxR: R * mult, life, color, width: Math.max(2, R * width) });

  // mode "plume" throws up-and-out (debris), "radial" sprays in all directions.
  const emit = (
    count: number,
    shape: Particle["shape"],
    spd: [number, number],
    life: [number, number],
    size: [number, number],
    grav: number,
    colors: string[],
    grow: number,
    mode: "plume" | "radial"
  ) => {
    for (let i = 0; i < count; i++) {
      const sp = spd[0] + r() * (spd[1] - spd[0]);
      let vx: number;
      let vy: number;
      if (mode === "radial") {
        const a = r() * Math.PI * 2;
        vx = Math.cos(a) * sp;
        vy = Math.sin(a) * sp;
      } else {
        vx = (r() * 2 - 1) * sp;
        vy = -(0.2 + r()) * sp; // bias upward
      }
      const ml = Math.round(life[0] + r() * (life[1] - life[0]));
      particles.push({
        x: ex,
        y: ey,
        vx,
        vy,
        grav,
        life: ml,
        maxLife: ml,
        size: size[0] + r() * (size[1] - size[0]),
        grow,
        color: colors[(r() * colors.length) | 0],
        shape,
      });
    }
  };

  switch (fx) {
    case "fire":
      ring(1.6, 16, "#ffb86a", 0.08);
      // Tall fountain of flame: lots of fast upward embers + a few slow ones.
      emit(Math.round(22 * dens), "spark", [2, 6.5], [16, 36], [1.5, 3.2], 0.04, ["#ffd24a", "#ff7a1f", "#ff4a10", "#ffae3a"], 0, "plume");
      emit(Math.round(7 * dens), "smoke", [0.3, 1.2], [34, 56], [6, 12], -0.015, [smoke, "#1c1814"], 0.5, "plume");
      break;
    case "dirt":
      ring(1.5, 18, "#caa86a", 0.07);
      emit(Math.round(16 * dens), "chunk", [1.5, 5], [20, 40], [2, 4.5], 0.42, ["#a8854a", "#7a5e34", "#c9a76a", "#5a4a2e"], 0, "plume");
      emit(Math.round(8 * dens), "smoke", [0.3, 1.1], [26, 46], [5, 10], -0.01, [smoke, "#6b5a3e"], 0.6, "plume");
      break;
    case "spark":
      ring(1.9, 12, shell, 0.05);
      // Crisp radial starburst — long fast streaks shooting out in all directions.
      emit(Math.round(26 * dens), "spark", [4, 11], [9, 20], [1, 2.4], 0.08, ["#ffffff", shell, burst], 0, "radial");
      emit(Math.round(3 * dens), "smoke", [0.2, 0.8], [18, 30], [3, 6], -0.01, [smoke], 0.4, "plume");
      break;
    case "plasma":
      ring(2.6, 14, "#bdf6ff", 0.1);
      ring(1.5, 10, "#ffffff", 0.05);
      // Electric starburst, faster and brighter than a normal spark.
      emit(Math.round(30 * dens), "spark", [4.5, 12.5], [9, 22], [1, 2.6], 0.04, ["#ffffff", "#aef6ff", "#39d6ff", "#7fd8ff"], 0, "radial");
      break;
    case "frost":
      ring(2, 22, "#eafaff", 0.08);
      emit(Math.round(16 * dens), "chunk", [1.4, 4.5], [24, 44], [1.5, 3.5], 0.18, ["#dff4ff", "#a9e2ff", "#ffffff", "#bfe6f5"], 0, "plume");
      emit(Math.round(9 * dens), "smoke", [0.2, 1], [34, 52], [6, 13], -0.02, ["#cfeaf6", "#eafaff"], 0.6, "plume");
      break;
    default: // "blast"
      ring(2.1, 20, "#ffe6a8", 0.1);
      if (R >= 70) {
        flash = Math.min(0.8, R / 130); // nuke-class white flash
        ring(1.4, 14, "#ffffff", 0.06);
      }
      emit(Math.round(14 * dens), "chunk", [1.6, 5.5], [18, 40], [2, 4.5], 0.38, [burst, shell, "#ffd24a", "#ff9a3a"], 0, "plume");
      emit(Math.round(8 * dens), "smoke", [0.3, 1.3], [30, 50], [6, 12], -0.02, [smoke, "#3a342c"], 0.6, "plume");
      emit(Math.round(6 * dens), "spark", [3, 7], [8, 16], [1, 2.2], 0.1, ["#ffffff", burst], 0, "radial");
  }
  return flash;
}

/** Drop a trail particle behind a flying shell for styles that need one — a
 *  contrail (smoke), a fiery wake (ember) or a sparkle wake (spark). Pocket
 *  Tanks-style; "line"/"glow" rely on the drawn comet instead. */
function spawnTrail(
  style: NonNullable<Weapon["style"]["trailStyle"]>,
  p: Point,
  color: string,
  frame: number,
  particles: Particle[]
): void {
  const r = Math.random;
  if (style === "smoke") {
    if (frame % 2 !== 0) return; // a puff every other frame → contrail
    const ml = Math.round(28 + r() * 18);
    particles.push({
      x: p.x + (r() * 2 - 1) * 2, y: p.y + (r() * 2 - 1) * 2,
      vx: (r() * 2 - 1) * 0.25, vy: -(0.15 + r() * 0.35), grav: -0.004,
      life: ml, maxLife: ml, size: 2.5 + r() * 2, grow: 0.18, color: "#9a958c", shape: "smoke",
    });
  } else if (style === "ember") {
    if (r() < 0.4) return;
    const ml = Math.round(12 + r() * 12);
    particles.push({
      x: p.x + (r() * 2 - 1) * 2, y: p.y,
      vx: (r() * 2 - 1) * 0.5, vy: -(0.2 + r() * 0.7), grav: -0.01,
      life: ml, maxLife: ml, size: 1 + r() * 1.6, grow: 0,
      color: ["#ffd24a", "#ff7a1f", "#ff4a10"][(r() * 3) | 0], shape: "spark",
    });
  } else if (style === "spark") {
    if (r() < 0.45) return;
    const ml = Math.round(8 + r() * 10);
    particles.push({
      x: p.x + (r() * 2 - 1) * 1.5, y: p.y + (r() * 2 - 1) * 1.5,
      vx: (r() * 2 - 1) * 0.6, vy: (r() * 2 - 1) * 0.6, grav: 0.02,
      life: ml, maxLife: ml, size: 0.8 + r() * 1.4, grow: 0, color, shape: "spark",
    });
  }
}

/** Per-seat impact feedback, latched when a blast first overlaps a tank. */
interface ImpactFx {
  seat: number;
  born: number; // frame the blast landed
  amount: number; // damage dealt (for the floating number)
  killed: boolean;
  toX: number; // post-shot x — the tank slides here (knockback)
  preHealth: number;
  postHealth: number;
}

/** A floating damage number / kill marker rising above a struck tank. */
interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  big: boolean;
}

/** Canvas renderer for the artillery battlefield: terrain, luxe tanks, health
 *  bars, the active barrel, and staged per-weapon shell trajectories. */
export default function TankCanvas({ state, mySeat, aim, animation, muted, onAnimationEnd }: TankCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  const aimRef = useRef(aim);
  const mutedRef = useRef(muted);
  // Per-seat displayed x, eased toward the authoritative x so drives slide.
  const displayedRef = useRef<number[]>([]);
  stateRef.current = state;
  aimRef.current = aim;
  mutedRef.current = muted;

  // Idle render — eases each tank toward its authoritative x (drive slide),
  // then settles. Runs whenever the state/aim changes and no shot is animating.
  useEffect(() => {
    if (animation) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const tanks = stateRef.current.tanks;
    if (displayedRef.current.length !== tanks.length) displayedRef.current = tanks.map((t) => t.x);

    let raf: number | null = null;
    const ease = () => {
      const st = stateRef.current;
      let moving = false;
      for (const t of st.tanks) {
        const cur = displayedRef.current[t.seat] ?? t.x;
        const d = t.x - cur;
        // Constant-speed roll (≈ DRIVE_SPEED world-units/frame) so the tank
        // trundles like real treads instead of easing/snapping into place.
        if (Math.abs(d) > DRIVE_SPEED) {
          displayedRef.current[t.seat] = cur + Math.sign(d) * DRIVE_SPEED;
          moving = true;
        } else {
          displayedRef.current[t.seat] = t.x;
        }
      }
      drawScene(
        ctx,
        canvas,
        st,
        aimRef.current ?? null,
        mySeat,
        { heads: [], trails: [], bursts: [], recoil: 0 },
        (seat) => displayedRef.current[seat] ?? st.tanks[seat].x
      );
      raf = moving ? requestAnimationFrame(ease) : null;
    };
    ease();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [state, aim, mySeat, animation]);

  // Animated render — steps every shell along its (staged) path, fires muzzle
  // flash + recoil, and blooms a per-weapon explosion at each impact.
  useEffect(() => {
    if (!animation) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const shells = animation.shells;
    const pre = stateRef.current; // board before the shot resolves
    const post = animation.endState?.tanks ?? pre.tanks; // board after (damage + knockback)
    const lastSimStep = Math.max(1, ...shells.map((s) => s.startStep + s.path.length));
    // Run the clock at ~real simulation time (≈0.9 sim-steps/frame) so the shell
    // travels at its true ballistic speed — fast off the muzzle, slowing as drag
    // and the climb bleed its energy — rather than stretching every shot to a
    // fixed duration. The on-screen flight is clamped to a comfortable window.
    const MIN_FRAMES = 42; // ~0.7s floor (short shots stay readable)
    const MAX_FRAMES = 168; // ~2.8s ceiling (long lobs don't drag on)
    const totalFrames = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, lastSimStep / 0.9));
    const stepPerFrame = lastSimStep / totalFrames;
    const FADE = 26; // explosion fade in frames
    const bursts: Burst[] = [];
    const burstFired = new Set<number>();
    const launched = new Set<number>(); // shells that have left the barrel
    const impacts = new Map<number, ImpactFx>(); // seat → latched hit feedback
    const particles: Particle[] = []; // debris / sparks / smoke
    const shocks: ShockSrc[] = []; // expanding shockwave rings
    const flames: Flame[] = []; // lingering Napalm fire patches
    let shakeMag = 0; // current screen-shake amplitude (px), decays each frame
    let flashMag = 0; // full-screen white flash (huge blasts), decays each frame
    let frame = 0;
    // Positions are settled when a shot fires; sync so tanks render in place.
    displayedRef.current = pre.tanks.map((t) => t.x);
    if (!mutedRef.current) playFire(); // cannon report at launch

    // Hit centre Y of a tank at world x (matches the engine's tankCentre).
    const centreY = (x: number) =>
      pre.terrain[Math.max(0, Math.min(pre.terrain.length - 1, Math.round(x)))] - TANK_BODY;

    const tick = () => {
      frame += 1;
      const simStep = frame * stepPerFrame;
      const heads: Head[] = [];
      const trails: { pts: Point[]; color: string; style: TrailStyle }[] = [];

      shells.forEach((shell, i) => {
        if (simStep < shell.startStep) return; // not launched yet
        const w = weaponById(shell.weaponId);
        // Muzzle re-flash + report for each rapid-fire salvo slug as it launches.
        if (!launched.has(i)) {
          launched.add(i);
          if (shell.startStep > 0 && w.kind === "salvo") {
            const m = shell.path[0];
            bursts.push({ x: m.x, y: m.y, color: w.style.burst, radius: 8, born: frame });
            if (!mutedRef.current) playFire();
          }
        }
        const local = simStep - shell.startStep; // fractional steps along the path
        const lastIdx = shell.path.length - 1;
        if (local < lastIdx) {
          // Interpolate the head between samples so it glides smoothly at any
          // speed — the gap between samples already encodes the real velocity.
          const i0 = Math.floor(local);
          const frac = local - i0;
          const a = shell.path[i0];
          const b = shell.path[Math.min(i0 + 1, lastIdx)];
          const p = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
          const tstyle = w.style.trailStyle ?? "line";
          trails.push({ pts: shell.path.slice(0, i0 + 1).concat(p), color: w.style.trail, style: tstyle });
          heads.push({
            p,
            color: w.style.shell,
            r: w.style.shellRadius,
            shape: w.style.shellShape ?? "round",
            angle: Math.atan2(b.y - a.y, b.x - a.x),
          });
          spawnTrail(tstyle, p, w.style.trail, frame, particles);
        } else {
          trails.push({ pts: shell.path, color: w.style.trail, style: w.style.trailStyle ?? "line" });
          if (shell.impact && !burstFired.has(i)) {
            burstFired.add(i);
            bursts.push({ x: shell.impact.x, y: shell.impact.y, color: w.style.burst, radius: w.blastRadius, born: frame });
            flashMag = Math.max(flashMag, spawnExplosion(shell.impact.x, shell.impact.y, w, frame, particles, shocks));
            if (w.style.lingerFire) flames.push({ x: shell.impact.x, y: shell.impact.y, born: frame, life: LINGER_FRAMES });
            if (!mutedRef.current) playBoom(w.blastRadius);
            // Latch hit feedback on any alive tank this blast overlapped — same
            // radius the engine used to deal the damage, so they always agree.
            const impact = shell.impact;
            for (const t of pre.tanks) {
              if (!t.alive || impacts.has(t.seat)) continue;
              const d = Math.hypot(impact.x - t.x, impact.y - centreY(t.x));
              if (d > w.blastRadius) continue;
              const pst = post[t.seat];
              impacts.set(t.seat, {
                seat: t.seat,
                born: frame,
                amount: Math.max(0, t.health - pst.health),
                killed: t.alive && !pst.alive,
                toX: pst.x,
                preHealth: t.health,
                postHealth: pst.health,
              });
              shakeMag = Math.max(shakeMag, Math.min(9, 3 + w.blastRadius * 0.08 + (t.health - pst.health) * 0.12));
            }
          }
        }
      });

      // Advance knockback slides and build per-seat draw overrides + popups.
      const fx = new Map<number, { health: number; bob: number }>();
      const popups: Popup[] = [];
      for (const im of impacts.values()) {
        const cur = displayedRef.current[im.seat] ?? pre.tanks[im.seat].x;
        const dx = im.toX - cur;
        // Slide to the knocked position; bigger shoves slide faster so a launch
        // and a nudge both settle in roughly the same beat.
        const slide = Math.max(KNOCK_SPEED, Math.abs(im.toX - pre.tanks[im.seat].x) / 12);
        displayedRef.current[im.seat] = Math.abs(dx) > slide ? cur + Math.sign(dx) * slide : im.toX;
        const age = frame - im.born;
        const drain = Math.min(1, age / DRAIN_FRAMES);
        const health = im.preHealth + (im.postHealth - im.preHealth) * drain;
        const bob = age < JOLT_FRAMES ? -Math.sin((age / JOLT_FRAMES) * Math.PI) * JOLT_RISE : 0;
        fx.set(im.seat, { health, bob });
        if (im.amount > 0 && age < POPUP_FRAMES) {
          const px = displayedRef.current[im.seat] ?? im.toX;
          popups.push({
            x: px,
            y: centreY(px) - 40 - age * 0.9,
            text: im.killed ? "DESTROYED" : `-${im.amount}`,
            color: im.killed ? "#ff5a4a" : "#ffd24a",
            alpha: Math.max(0, 1 - age / POPUP_FRAMES),
            big: im.killed,
          });
        }
      }
      shakeMag *= 0.86;
      const shake =
        shakeMag > 0.3
          ? { x: Math.sin(frame * 1.7) * shakeMag, y: Math.sin(frame * 2.6) * shakeMag * 0.7 }
          : { x: 0, y: 0 };

      // Advance particles (move, fall, billow, age out) and decay the flash.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.grav;
        p.vx *= 0.985; // air drag on debris
        p.size += p.grow;
        if (--p.life <= 0) particles.splice(i, 1);
      }
      flashMag *= 0.8;
      // Shockwave rings, rendered from their age.
      const rings = shocks
        .map((s) => {
          const t = (frame - s.born) / s.life;
          return { x: s.x, y: s.y, r: s.maxR * t, alpha: Math.max(0, 1 - t), color: s.color, width: s.width };
        })
        .filter((s) => s.alpha > 0);

      // Lingering Napalm fire — keeps spitting embers and glowing until it burns
      // out. Build render-ready flames (intensity fades over their life).
      const fires: { x: number; y: number; intensity: number }[] = [];
      for (let i = flames.length - 1; i >= 0; i--) {
        const fl = flames[i];
        const age = frame - fl.born;
        if (age >= fl.life) {
          flames.splice(i, 1);
          continue;
        }
        const intensity = 1 - age / fl.life;
        fires.push({ x: fl.x, y: fl.y, intensity });
        // Spit a rising ember now and then.
        if (Math.random() < 0.6) {
          const ml = Math.round(14 + Math.random() * 16);
          particles.push({
            x: fl.x + (Math.random() * 2 - 1) * 7,
            y: fl.y - Math.random() * 4,
            vx: (Math.random() * 2 - 1) * 0.7,
            vy: -(0.6 + Math.random() * 1.4),
            grav: -0.012,
            life: ml,
            maxLife: ml,
            size: 1 + Math.random() * 2,
            grow: 0,
            color: ["#ffd24a", "#ff7a1f", "#ff4a10"][(Math.random() * 3) | 0],
            shape: "spark",
          });
        }
      }

      const live = bursts.filter((b) => frame - b.born < FADE);
      const recoil = Math.max(0, 1 - frame / 7); // 0..1 over the first ~7 frames

      drawScene(
        ctx,
        canvas,
        pre,
        null,
        mySeat,
        {
          heads,
          trails,
          bursts: live.map((b) => ({ ...b, age: (frame - b.born) / FADE })),
          recoil,
          shake,
          fx,
          popups,
          particles,
          rings,
          fires,
          fireSeed: frame,
          flash: flashMag,
        },
        (seat) => displayedRef.current[seat] ?? pre.tanks[seat].x
      );

      const flying = shells.some((s) => simStep < s.startStep + s.path.length - 1);
      // Hold the frame open until shells land, blasts fade, debris settles,
      // lingering fire burns out, knockback slides finish and the last damage
      // number has risen away.
      const settling = [...impacts.values()].some(
        (im) =>
          Math.abs((displayedRef.current[im.seat] ?? im.toX) - im.toX) > 0.5 ||
          (im.amount > 0 && frame - im.born < POPUP_FRAMES)
      );
      if (!flying && live.length === 0 && particles.length === 0 && flames.length === 0 && !settling) {
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
  heads: Head[];
  trails: { pts: Point[]; color: string; style: TrailStyle }[];
  bursts: { x: number; y: number; color: string; radius: number; age?: number }[];
  /** 0 = at rest, 1 = full recoil (applied to the seat on turn). */
  recoil: number;
  /** Camera shake offset (px) applied to the world during a blast. */
  shake?: { x: number; y: number };
  /** Per-seat hit overrides: drained health + vertical jolt. */
  fx?: Map<number, { health: number; bob: number }>;
  /** Floating damage numbers / kill markers. */
  popups?: Popup[];
  /** Explosion debris / sparks / smoke. */
  particles?: Particle[];
  /** Expanding shockwave rings (render-ready). */
  rings?: { x: number; y: number; r: number; alpha: number; color: string; width: number }[];
  /** Lingering Napalm fire patches (intensity fades as they burn out). */
  fires?: { x: number; y: number; intensity: number }[];
  /** Frame counter, so fire flicker animates over time. */
  fireSeed?: number;
  /** Full-screen white flash for huge blasts (0 = none). */
  flash?: number;
}

/** Draw a shell's trail as a tapered comet that fades toward the tail. Energy,
 *  ice and fiery weapons ("glow") burn additively with a white-hot core, the
 *  way Pocket Tanks streaks read. "smoke"/"spark"/"ember" keep the line subtle
 *  because their wake is carried by particles. */
function drawTrail(ctx: CanvasRenderingContext2D, pts: Point[], color: string, style: TrailStyle): void {
  const n = pts.length;
  if (n < 2) return;
  const glow = style === "glow";
  const subtle = style === "smoke" || style === "spark" || style === "ember";
  const TAIL = Math.min(n - 1, glow ? 46 : 36); // comet length in samples
  const start = n - 1 - TAIL;

  if (glow) ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = start; i < n - 1; i++) {
    const f = (i - start) / TAIL; // 0 at the tail … 1 at the head
    ctx.globalAlpha = (glow ? 0.55 : subtle ? 0.3 : 0.5) * f * f;
    ctx.lineWidth = (glow ? 4 : 2.4) * (0.25 + f);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
    ctx.stroke();
  }
  if (glow) {
    // Bright white-hot core over the leading stretch.
    const coreStart = Math.max(start, n - 16);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    for (let i = coreStart; i < n; i++) (i === coreStart ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y));
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = 1;
}

/** Draw a shell in flight with a recognisable, heading-oriented silhouette so a
 *  player can read the incoming round on sight. */
function drawShell(ctx: CanvasRenderingContext2D, h: Head): void {
  const { p, color, r, shape, angle } = h;

  // Soft glow behind every shell.
  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);

  switch (shape) {
    case "dart": {
      // Slender needle with a white-hot tip (Sniper / Railgun).
      const len = r * 5.5;
      const w = r * 0.85;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(len * 0.6, 0);
      ctx.lineTo(-len * 0.4, w);
      ctx.lineTo(-len * 0.4, -w);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(len * 0.45, 0, w, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "shell": {
      // Classic artillery shell: ogive nose + cylindrical body (the Shell).
      const len = r * 2.6;
      const w = r * 0.95;
      const body = ctx.createLinearGradient(0, -w, 0, w);
      body.addColorStop(0, "#fff7d8");
      body.addColorStop(0.5, color);
      body.addColorStop(1, "#9a7322");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(len, 0); // pointed nose
      ctx.quadraticCurveTo(len * 0.5, -w, len * 0.1, -w);
      ctx.lineTo(-len * 0.7, -w); // body
      ctx.lineTo(-len * 0.7, w);
      ctx.lineTo(len * 0.1, w);
      ctx.quadraticCurveTo(len * 0.5, w, len, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(40,30,10,0.5)"; // driving band
      ctx.fillRect(-len * 0.55, -w, r * 0.5, w * 2);
      break;
    }
    case "heavy": {
      // Fat iron round with a tail fin and a hot highlight (Big Shot).
      ctx.fillStyle = "#26242a";
      ctx.beginPath();
      ctx.moveTo(-r * 1.3, 0);
      ctx.lineTo(-r * 2.4, -r);
      ctx.lineTo(-r * 2.4, r);
      ctx.closePath();
      ctx.fill();
      const body = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.2, 0, 0, r * 1.3);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.4, color);
      body.addColorStop(1, "#7a4a1a");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "warhead": {
      // Finned missile with a red nose and a pulsing warning halo (Nuke).
      const len = r * 3.2;
      const w = r * 0.95;
      ctx.fillStyle = "rgba(255,40,30,0.3)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9aa3af"; // tail fins
      ctx.beginPath();
      ctx.moveTo(-len * 0.7, -w);
      ctx.lineTo(-len, -w * 1.9);
      ctx.lineTo(-len * 0.45, -w * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-len * 0.7, w);
      ctx.lineTo(-len, w * 1.9);
      ctx.lineTo(-len * 0.45, w * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#dfe4e9"; // body
      ctx.beginPath();
      ctx.moveTo(len * 0.45, -w);
      ctx.lineTo(-len * 0.7, -w);
      ctx.lineTo(-len * 0.7, w);
      ctx.lineTo(len * 0.45, w);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e0402a"; // red nose cone
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(len * 0.45, -w);
      ctx.lineTo(len * 0.45, w);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "drill": {
      // Auger cone with grooves, biting forward (Digger).
      const len = r * 3;
      const w = r;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(-len * 0.5, -w);
      ctx.lineTo(-len * 0.5, w);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(40,28,12,0.7)";
      ctx.lineWidth = Math.max(1, r * 0.3);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(len * 0.4 + i * r * 0.9, -w * 0.6);
        ctx.lineTo(len * 0.1 + i * r * 0.9, w * 0.6);
        ctx.stroke();
      }
      break;
    }
    case "piston": {
      // Blocky industrial slug with a bright flat head (Jackhammer).
      const len = r * 2.4;
      const w = r * 1.05;
      ctx.fillStyle = "#34302a";
      ctx.fillRect(-len * 0.6, -w, len * 1.2, w * 2);
      const cap = ctx.createLinearGradient(0, -w, 0, w);
      cap.addColorStop(0, "#ffffff");
      cap.addColorStop(0.5, color);
      cap.addColorStop(1, "#7a5a2a");
      ctx.fillStyle = cap;
      ctx.fillRect(len * 0.2, -w * 1.2, len * 0.5, w * 2.4);
      break;
    }
    default: {
      // Plain bright ball (Shell and most weapons).
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: GameState,
  aim: { angle: number; power: number } | null,
  mySeat: number | null,
  overlay: Overlay,
  posOf?: (seat: number) => number
): void {
  const W = canvas.width;
  const H = canvas.height;

  // Sky with a soft sun glow (drawn before any camera shake so the screen edges
  // never reveal a gap when the world is jolted).
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

  // Everything below the sky shakes together as one "camera".
  ctx.save();
  ctx.translate(overlay.shake?.x ?? 0, overlay.shake?.y ?? 0);

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

  // Tanks. In a team match all teammates share their team's colour.
  for (const tank of state.tanks) {
    const drawX = posOf ? posOf(tank.seat) : tank.x;
    const surfX = Math.min(state.terrain.length - 1, Math.max(0, Math.round(drawX)));
    const ty = state.terrain[surfX];
    const onTurn = !state.gameOver && state.turn === tank.seat;
    const useAim = aim && mySeat === tank.seat ? aim : { angle: tank.angle, power: tank.power };
    const colorIdx = state.teamSize > 0 ? tank.team : tank.seat;
    // A struck tank drains its health bar and jolts upward as the blast lands.
    const hit = overlay.fx?.get(tank.seat);
    const shownHealth = hit ? hit.health : tank.health;
    drawTank(ctx, drawX, ty, colorIdx, useAim.angle, tank.alive, shownHealth, onTurn, onTurn ? overlay.recoil : 0, hit?.bob ?? 0);
    // Wind read-out above the tank whose turn it is.
    if (onTurn && tank.alive) drawWindTag(ctx, drawX, Math.max(16, ty - 66), state.wind);
  }

  // Shell trails — a tapered comet that fades toward the tail; energy/ice
  // weapons glow additively with a bright core.
  for (const t of overlay.trails) drawTrail(ctx, t.pts, t.color, t.style);
  for (const h of overlay.heads) drawShell(ctx, h);

  // Explosions — Pocket Tanks-style: a bright saturated bloom that pops out fast
  // (ease-out) over a white-hot core, drawn additively so it really glows.
  ctx.globalCompositeOperation = "lighter";
  for (const b of overlay.bursts) {
    const age = b.age ?? 0; // 0..1 over the blast's life
    const ease = 1 - (1 - age) * (1 - age); // fast expansion, easing out
    const R = b.radius * (0.55 + ease * 0.7); // pops to ~1.25× the affect range
    const fade = 1 - age;
    // Coloured bloom.
    ctx.globalAlpha = fade * 0.9;
    const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, R);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.35, b.color);
    g.addColorStop(0.72, b.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, R, 0, Math.PI * 2);
    ctx.fill();
    // White-hot core that collapses as it fades.
    const core = b.radius * (0.5 - age * 0.4);
    if (core > 0) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = "rgba(255,252,235,0.95)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, core, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // Shockwave rings expanding out of each blast.
  for (const s of overlay.rings ?? []) {
    ctx.globalAlpha = s.alpha * 0.8;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (0.4 + s.alpha * 0.6);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Lingering Napalm fire — a flickering glow at the base, embers handled by the
  // particle layer above this.
  for (const f of overlay.fires ?? []) {
    const flick = 0.75 + 0.25 * Math.sin(f.x * 0.5 + (overlay.fireSeed ?? 0));
    const r = (10 + 9 * f.intensity) * flick;
    ctx.globalAlpha = Math.min(0.85, f.intensity + 0.15);
    const g = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, r);
    g.addColorStop(0, "rgba(255,240,180,0.95)");
    g.addColorStop(0.45, "rgba(255,120,30,0.8)");
    g.addColorStop(1, "rgba(120,20,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - r * 0.3, r * 0.7, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Debris / sparks / smoke — smoke behind, glowing sparks on top.
  const parts = overlay.particles ?? [];
  for (const p of parts) {
    if (p.shape !== "smoke") continue;
    ctx.globalAlpha = (p.life / p.maxLife) * 0.45;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of parts) {
    if (p.shape !== "chunk") continue;
    ctx.globalAlpha = Math.min(1, p.life / p.maxLife + 0.2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter"; // sparks glow
  for (const p of parts) {
    if (p.shape !== "spark") continue;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(0.6, p.size);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6); // motion streak
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // Floating damage numbers / kill markers, above everything.
  for (const p of overlay.popups ?? []) {
    ctx.globalAlpha = p.alpha;
    ctx.font = `bold ${p.big ? 20 : 17}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  ctx.restore(); // end camera shake

  // Full-screen flash for huge blasts (drawn over everything, no shake).
  if (overlay.flash && overlay.flash > 0.01) {
    ctx.globalAlpha = Math.min(0.6, overlay.flash);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
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
  recoil: number,
  bob = 0
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

  // Recoil shifts the whole tank opposite the barrel; bob lifts it on a blast.
  const rad = (angleDeg * Math.PI) / 180;
  const cx = x - Math.cos(rad) * 6 * recoil;
  const cy = baseY + bob;

  // Ground shadow — stays on the ground (tightens as the tank is jolted up).
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 1, Math.max(12, 20 + bob), 5, 0, 0, Math.PI * 2);
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
