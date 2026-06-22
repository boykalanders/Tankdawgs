import type {
  DamageEvent,
  GameState,
  Point,
  Shell,
  ShotInput,
  ShotResult,
  Tank,
} from "./types.js";
import { weaponById, DEFAULT_WEAPON } from "./weapons.js";

// ─────────────────────────── world constants ───────────────────────────
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 600;

// ── external ballistics ──────────────────────────────────────────────────
// A shell obeys real projectile motion. Gravity pulls it down at a constant
// accel; air drag opposes its motion and grows with speed², so it bleeds the
// most energy just off the muzzle (where it's fastest — "supersonic") and ever
// less as it slows. Between drag losses, kinetic and potential energy trade off
// (conservation of energy): the shell is slowest at the apex and speeds back up
// as it falls — but, having shed energy to drag, it always strikes BELOW its
// muzzle velocity. High power ⇒ high muzzle velocity ⇒ a flatter, faster path.
const GRAVITY = 0.32; // downward accel per step² (y grows down)
const POWER_SCALE = 0.3; // power 1–100 → muzzle speed 0.3–30 units/step
const WIND_ACCEL = 0.03; // horizontal accel per step at |wind| = 1
const DRAG = 0.0009; // quadratic air-drag coefficient (accel = DRAG·speed²)
const SUBSTEPS = 3; // integration sub-steps per recorded path point
const DT = 1;
const MAX_STEPS = 3000;

// Blast knockback: a near miss shoves a tank away from the epicentre. The push
// scales with the blast's intensity at the tank (same falloff as damage) and
// with how side-on the blast was — a hit directly overhead barely budges it.
const KNOCK_SCALE = 0.5; // world-units of slide per point of blast intensity
const MAX_KNOCK = 38; // cap the total shove per tank per shot
const MUZZLE_RISE = 16; // launch this far above the tank's surface
const TANK_BODY = 8; // half-height of a tank body (for hit/centre)
const TANK_HIT_RADIUS = 14; // a pellet striking within this hits the tank
const MIN_GROUND = Math.round(WORLD_HEIGHT * 0.28); // highest a peak can be
const MAX_GROUND = Math.round(WORLD_HEIGHT * 0.92); // lowest a valley can be

/** Drive steps a tank may take per turn, and the world distance per step. */
export const MOVES_PER_TURN = 5;
const MOVE_STEP = 22;
/** A tank can't climb a step steeper than this (world units of rise). */
const MAX_CLIMB = 60;

// ─────────────────────────── deterministic RNG ───────────────────────────
/** Numeric LCG step — deterministic, no Math.random (would break sync). */
function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}
function rand01(seed: number): number {
  return (seed >>> 0) / 0x100000000;
}
/** Stable 32-bit seed from a string (e.g. the gameId), so server + client agree. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function windFromSeed(seed: number): number {
  return Math.round((rand01(seed) * 2 - 1) * 100) / 100; // −1..1, 2 dp
}

// ─────────────────────────── terrain ───────────────────────────
/** Generate rolling, deterministic hills from a seed. */
function generateTerrain(width: number, seed: number): number[] {
  let s = nextSeed(seed);
  // A few sine waves with seed-derived amplitudes/phases → natural hills.
  const waves = [
    { amp: 70 + rand01((s = nextSeed(s))) * 50, len: 900 + rand01((s = nextSeed(s))) * 400, ph: rand01((s = nextSeed(s))) * Math.PI * 2 },
    { amp: 30 + rand01((s = nextSeed(s))) * 30, len: 340 + rand01((s = nextSeed(s))) * 220, ph: rand01((s = nextSeed(s))) * Math.PI * 2 },
    { amp: 12 + rand01((s = nextSeed(s))) * 14, len: 120 + rand01((s = nextSeed(s))) * 80, ph: rand01((s = nextSeed(s))) * Math.PI * 2 },
  ];
  const base = WORLD_HEIGHT * 0.62;
  const terrain = new Array<number>(width);
  for (let x = 0; x < width; x++) {
    let y = base;
    for (const w of waves) y -= w.amp * Math.sin((x / w.len) * Math.PI * 2 + w.ph);
    terrain[x] = Math.max(MIN_GROUND, Math.min(MAX_GROUND, Math.round(y)));
  }
  return terrain;
}

/** Round a world x to an in-bounds integer column index. */
const clampX = (x: number, width: number): number => {
  const c = Math.round(x);
  return c < 0 ? 0 : c >= width ? width - 1 : c;
};

/** Surface Y at a (possibly fractional) world x. */
export function terrainAt(state: GameState, x: number): number {
  return state.terrain[clampX(Math.round(x), state.width)];
}

// ─────────────────────────── setup ───────────────────────────
export interface InitOptions {
  players: number;
  seed: number;
  /** Players per team: 0 (or 1) = free-for-all; 2/3/4 = 2v2/3v3/4v4. */
  teamSize?: number;
  width?: number;
  height?: number;
}

/** Team a seat belongs to. FFA → its own team (== seat); team mode → block of
 *  `teamSize` seats (0…S-1 = team 0 on the left, S…2S-1 = team 1 on the right). */
export function teamOf(seat: number, teamSize: number): number {
  return teamSize >= 2 ? Math.floor(seat / teamSize) : seat;
}

/** Fresh battlefield: hills + N tanks spread across the width, seat 0 to move. */
export function createInitialState(opts: InitOptions): GameState {
  const width = opts.width ?? WORLD_WIDTH;
  const height = opts.height ?? WORLD_HEIGHT;
  const n = Math.max(2, opts.players);
  const teamSize = opts.teamSize && opts.teamSize >= 2 ? opts.teamSize : 0;
  const terrain = generateTerrain(width, opts.seed);

  const margin = Math.round(width * 0.08);
  const span = width - margin * 2;
  const tanks: Tank[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? Math.round(width / 2) : Math.round(margin + (span * i) / (n - 1));
    tanks.push({
      seat: i,
      team: teamOf(i, teamSize),
      x,
      health: 100,
      alive: true,
      // Aim inward: left half points east, right half points west.
      angle: x < width / 2 ? 50 : 130,
      power: 55,
    });
  }

  const windSeed = nextSeed(opts.seed ^ 0x9e3779b9);
  return {
    width,
    height,
    terrain,
    tanks,
    teamSize,
    turn: 0,
    wind: windFromSeed(windSeed),
    seed: windSeed,
    movesLeft: MOVES_PER_TURN,
    gameOver: false,
    winner: null,
    moveCount: 0,
  };
}

/** Drive the tank on turn one step left (dir −1) or right (dir +1), following
 *  the surface. Consumes a move; refuses if out of moves, off the board, into
 *  another tank, or up an impassable slope. Returns the (possibly unchanged)
 *  state. */
export function driveTank(state: GameState, dir: number): GameState {
  if (state.gameOver || state.movesLeft <= 0) return state;
  const step = dir >= 0 ? 1 : -1;
  const tank = state.tanks[state.turn];
  if (!tank || !tank.alive) return state;

  const nx = Math.round(tank.x + step * MOVE_STEP);
  if (nx < 0 || nx >= state.width) return state;
  // Blocked by another tank in the way.
  if (state.tanks.some((t) => t.alive && t.seat !== tank.seat && Math.abs(t.x - nx) < 24)) {
    return state;
  }
  // Too steep to climb.
  const here = state.terrain[clampX(tank.x, state.width)];
  const there = state.terrain[clampX(nx, state.width)];
  if (here - there > MAX_CLIMB) return state;

  const tanks = state.tanks.map((t) => (t.seat === tank.seat ? { ...t, x: nx } : { ...t }));
  return { ...state, tanks, movesLeft: state.movesLeft - 1 };
}

// ─────────────────────────── validation ───────────────────────────
export function validateShot(
  state: GameState,
  shot: ShotInput
): { ok: true } | { ok: false; reason: string } {
  if (state.gameOver) return { ok: false, reason: "game is over" };
  if (!Number.isFinite(shot.angle) || shot.angle < 0 || shot.angle > 180) {
    return { ok: false, reason: "angle must be 0–180°" };
  }
  if (!Number.isFinite(shot.power) || shot.power < 1 || shot.power > 100) {
    return { ok: false, reason: "power must be 1–100" };
  }
  if (!weaponById(shot.weaponId)) return { ok: false, reason: "unknown weapon" };
  return { ok: true };
}

// ─────────────────────────── simulation ───────────────────────────
const liveTanks = (s: GameState): Tank[] => s.tanks.filter((t) => t.alive);

function nextAliveSeat(state: GameState, from: number): number {
  const n = state.tanks.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (state.tanks[seat].alive) return seat;
  }
  return from;
}

/** Centre of a tank body, given the current (mutating) terrain. */
function tankCentre(tank: Tank, terrain: number[], width: number): Point {
  return { x: tank.x, y: terrain[clampX(tank.x, width)] - TANK_BODY };
}

/** Carve a circular crater into the terrain at (ex, ey). */
function carve(terrain: number[], width: number, ex: number, ey: number, radius: number, dig: number): void {
  const r = radius;
  const lo = Math.max(0, Math.floor(ex - r));
  const hi = Math.min(width - 1, Math.ceil(ex + r));
  for (let x = lo; x <= hi; x++) {
    const dx = x - ex;
    if (Math.abs(dx) > r) continue;
    const chord = Math.sqrt(r * r - dx * dx) * dig;
    const craterBottom = Math.min(WORLD_HEIGHT, Math.round(ey + chord));
    if (craterBottom > terrain[x]) terrain[x] = craterBottom;
  }
}

/** Integrate a projectile from an initial velocity; returns its polyline and
 *  impact (null if it flew off the left/right edges). `ignoreShooterSteps`
 *  skips shooter self-collision near the muzzle. Reads the live terrain. */
function integrate(
  origin: Point,
  vx0: number,
  vy0: number,
  state: GameState,
  terrain: number[],
  ignoreShooterSteps = 4
): { path: Point[]; impact: Point | null } {
  let vx = vx0;
  let vy = vy0;
  let x = origin.x;
  let y = origin.y;
  const path: Point[] = [{ x, y }];
  const { width, turn } = state;
  const windAccel = state.wind * WIND_ACCEL;
  const h = DT / SUBSTEPS;

  // One recorded path point per step; integrate each step as SUBSTEPS smaller
  // sub-steps so quadratic drag stays accurate/stable and a fast shell can't
  // tunnel past a tank between samples.
  for (let step = 0; step < MAX_STEPS; step++) {
    let impact: Point | null = null;
    let offBoard = false;
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      // Drag opposes velocity and scales with speed (force ∝ speed²); wind nudges
      // the air it flies through; gravity pulls it down.
      const speed = Math.hypot(vx, vy);
      vx += (windAccel - DRAG * speed * vx) * h;
      vy += (GRAVITY - DRAG * speed * vy) * h;
      x += vx * h;
      y += vy * h;

      if (x < 0 || x >= width) {
        offBoard = true; // off the sides
        break;
      }
      let hitTank = false;
      for (const t of state.tanks) {
        if (!t.alive) continue;
        if (t.seat === turn && step < ignoreShooterSteps) continue;
        const c = tankCentre(t, terrain, width);
        if ((x - c.x) ** 2 + (y - c.y) ** 2 <= TANK_HIT_RADIUS * TANK_HIT_RADIUS) {
          hitTank = true;
          break;
        }
      }
      if (hitTank) {
        impact = { x, y };
        break;
      }
      if (y >= terrain[clampX(x, width)]) {
        impact = { x, y };
        break;
      }
      if (y >= WORLD_HEIGHT) {
        impact = { x, y: WORLD_HEIGHT };
        break;
      }
    }
    path.push({ x, y });
    if (offBoard) return { path, impact: null };
    if (impact) return { path, impact };
  }
  return { path, impact: { x, y } };
}

/** Simulate one pellet from `origin` at an angle/power. */
function simulatePellet(
  origin: Point,
  angleDeg: number,
  power: number,
  state: GameState,
  terrain: number[]
): { path: Point[]; impact: Point | null } {
  const rad = (angleDeg * Math.PI) / 180;
  const speed = power * POWER_SCALE;
  return integrate(origin, Math.cos(rad) * speed, -Math.sin(rad) * speed, state, terrain);
}

/** Roll a landed shell downhill along the surface from `impact`, stopping at a
 *  valley (uphill ahead), a tank, the edge, or after maxDist. */
function rollAlong(
  terrain: number[],
  width: number,
  impact: Point,
  dir: number,
  maxDist: number,
  tanks: Tank[]
): { path: Point[]; end: Point } {
  const step = dir >= 0 ? 1 : -1;
  let x = Math.round(impact.x);
  const path: Point[] = [];
  for (let d = 0; d < maxDist; d++) {
    const nx = x + step;
    if (nx < 0 || nx >= width) break;
    // Stop if the ground ahead rises (uphill) — settle in the dip.
    if (terrain[nx] < terrain[x] - 1) break;
    x = nx;
    if (d % 4 === 0) path.push({ x, y: terrain[x] - 3 });
    // Stop on a tank in the path.
    if (tanks.some((t) => t.alive && Math.abs(t.x - x) <= 6)) break;
  }
  const end: Point = { x, y: terrain[clampX(x, width)] };
  path.push(end);
  return { path, end };
}

/** Deterministically resolve a shot — must pass validateShot first. */
export function simulateShot(state: GameState, shot: ShotInput): ShotResult {
  const weapon = weaponById(shot.weaponId) ?? weaponById(DEFAULT_WEAPON);
  const width = state.width;
  const terrain = state.terrain.slice(); // mutated by craters
  const shooter = state.tanks[state.turn];
  const origin: Point = {
    x: shooter.x,
    y: terrain[clampX(shooter.x, width)] - MUZZLE_RISE,
  };

  const shells: Shell[] = [];
  const dealt = new Map<number, number>(); // seat → damage
  const shove = new Map<number, number>(); // seat → horizontal knockback (px)
  let rngSeed = state.seed ^ 0x5bd1e995;
  const rng = () => {
    rngSeed = nextSeed(rngSeed);
    return rand01(rngSeed);
  };

  // Apply one explosion: blast-falloff damage + knockback to alive tanks, then
  // carve the crater.
  const explode = (impact: Point, radius: number, maxDamage: number, dig: number): void => {
    for (const t of state.tanks) {
      if (!t.alive) continue;
      const c = tankCentre(t, terrain, width);
      const dx = c.x - impact.x;
      const dist = Math.hypot(dx, impact.y - c.y);
      if (dist <= radius) {
        const intensity = maxDamage * (1 - dist / radius);
        dealt.set(t.seat, (dealt.get(t.seat) ?? 0) + intensity);
        // Push away from the epicentre, scaled by how horizontal the blast was
        // (dx/dist): a blast to the side shoves hardest, one overhead barely.
        const dirX = dist > 0.0001 ? dx / dist : 0;
        shove.set(t.seat, (shove.get(t.seat) ?? 0) + dirX * intensity * KNOCK_SCALE);
      }
    }
    carve(terrain, width, impact.x, impact.y, radius, dig);
  };
  const fire = (angle: number, power: number, from: Point = origin) =>
    simulatePellet(from, angle, power, state, terrain);
  const R = weapon.blastRadius;
  const D = weapon.maxDamage;
  const G = weapon.digFactor;

  switch (weapon.kind) {
    case "fan": {
      for (let p = 0; p < weapon.count; p++) {
        const offset = (p - (weapon.count - 1) / 2) * (weapon.spreadDeg / Math.max(1, weapon.count - 1));
        const { path, impact } = fire(shot.angle + offset, shot.power);
        if (impact) explode(impact, R, D, G);
        shells.push({ path, impact, startStep: 0, weaponId: weapon.id });
      }
      break;
    }
    case "cluster": {
      const primary = fire(shot.angle, shot.power);
      shells.push({ path: primary.path, impact: primary.impact, startStep: 0, weaponId: weapon.id });
      if (primary.impact) {
        const at = primary.path.length; // children appear when the shell lands
        for (let i = 0; i < weapon.count; i++) {
          const angle = 55 + rng() * 70; // up-and-out
          const power = 20 + rng() * 16;
          const from: Point = { x: primary.impact.x, y: primary.impact.y - 4 };
          const { path, impact } = fire(angle, power, from);
          if (impact) explode(impact, R, D, G);
          shells.push({ path, impact, startStep: at, weaponId: weapon.id });
        }
      }
      break;
    }
    case "mirv": {
      const primary = fire(shot.angle, shot.power);
      // Split partway down the descent (past the apex, but high enough to fan
      // out). Warheads INHERIT the primary's velocity there + a horizontal
      // spread, so they keep travelling toward — and around — the target.
      let apex = 0;
      for (let i = 1; i < primary.path.length; i++) if (primary.path[i].y < primary.path[apex].y) apex = i;
      const k = Math.min(
        primary.path.length - 2,
        Math.max(apex + 1, Math.floor(apex + (primary.path.length - apex) * 0.35))
      );
      const splitPt = primary.path[Math.max(1, k)];
      const prev = primary.path[Math.max(0, k - 1)];
      const baseVx = splitPt.x - prev.x;
      const baseVy = splitPt.y - prev.y;
      shells.push({ path: primary.path.slice(0, k + 1), impact: null, startStep: 0, weaponId: weapon.id });
      for (let i = 0; i < weapon.count; i++) {
        const spread = (i - (weapon.count - 1) / 2) * 1.6; // fan the warheads out
        const { path, impact } = integrate(
          { x: splitPt.x, y: splitPt.y },
          baseVx + spread,
          baseVy,
          state,
          terrain,
          0
        );
        if (impact) explode(impact, R, D, G);
        shells.push({ path, impact, startStep: k, weaponId: weapon.id });
      }
      break;
    }
    case "roller": {
      const primary = fire(shot.angle, shot.power);
      if (primary.impact) {
        const dir = primary.path.length >= 2
          ? Math.sign(primary.path[primary.path.length - 1].x - primary.path[primary.path.length - 2].x) || 1
          : 1;
        const rolled = rollAlong(terrain, width, primary.impact, dir, 220, state.tanks);
        explode(rolled.end, R, D, G);
        shells.push({
          path: primary.path.concat(rolled.path),
          impact: rolled.end,
          startStep: 0,
          weaponId: weapon.id,
        });
      } else {
        shells.push({ path: primary.path, impact: null, startStep: 0, weaponId: weapon.id });
      }
      break;
    }
    case "napalm": {
      const primary = fire(shot.angle, shot.power);
      shells.push({ path: primary.path, impact: primary.impact, startStep: 0, weaponId: weapon.id });
      if (primary.impact) {
        explode(primary.impact, R, D, G);
        const at = primary.path.length;
        for (let i = 0; i < weapon.count; i++) {
          const off = (i - (weapon.count - 1) / 2) * 26;
          const fx = clampX(primary.impact.x + off, width);
          const fy = terrain[fx] - 2;
          explode({ x: fx, y: fy }, R * 0.7, D * 0.7, G * 0.5);
          shells.push({
            path: [{ x: primary.impact.x, y: primary.impact.y }, { x: fx, y: fy }],
            impact: { x: fx, y: fy },
            startStep: at,
            weaponId: weapon.id,
          });
        }
      }
      break;
    }
    default: {
      // "single"
      const { path, impact } = fire(shot.angle, shot.power);
      if (impact) explode(impact, R, D, G);
      shells.push({ path, impact, startStep: 0, weaponId: weapon.id });
    }
  }

  // Apply damage and recompute survival.
  const tanks: Tank[] = state.tanks.map((t) => ({ ...t }));
  const damage: DamageEvent[] = [];
  for (const [seat, raw] of dealt) {
    const amount = Math.round(raw);
    if (amount <= 0) continue;
    const t = tanks[seat];
    const before = t.health;
    t.health = Math.max(0, before - amount);
    const killed = t.health === 0 && before > 0;
    if (killed) t.alive = false;
    damage.push({ seat, amount: before - t.health, killed });
  }
  // Knockback: shove surviving tanks along the surface, away from the blast.
  // Wrecks (just destroyed) stay put, and a tank can't be shoved off the board
  // or into another tank.
  for (const [seat, raw] of shove) {
    const t = tanks[seat];
    if (!t.alive) continue;
    const push = Math.max(-MAX_KNOCK, Math.min(MAX_KNOCK, raw));
    let nx = Math.round(t.x + push);
    nx = Math.max(0, Math.min(width - 1, nx));
    const blocked = tanks.some((o) => o.alive && o.seat !== seat && Math.abs(o.x - nx) < 20);
    if (!blocked) t.x = nx;
  }
  // Record the shooter's aim.
  tanks[state.turn] = { ...tanks[state.turn], angle: shot.angle, power: shot.power };

  const aliveAfter = tanks.filter((t) => t.alive);
  const aliveTeams = new Set(aliveAfter.map((t) => t.team));
  const gameOver = aliveTeams.size <= 1;
  // Winning team (and a representative surviving seat). Both null on a wipe.
  const winningTeam = gameOver && aliveTeams.size === 1 ? [...aliveTeams][0] : null;
  const winner = winningTeam !== null ? aliveAfter[0].seat : null;

  const advancedSeed = nextSeed(state.seed);
  const base: GameState = {
    ...state,
    terrain,
    tanks,
    gameOver,
    winner,
    moveCount: state.moveCount + 1,
  };
  const endState: GameState = gameOver
    ? { ...base, turn: state.turn, wind: state.wind, seed: advancedSeed }
    : {
        ...base,
        turn: nextAliveSeat({ ...base }, state.turn),
        wind: windFromSeed(advancedSeed),
        seed: advancedSeed,
        movesLeft: MOVES_PER_TURN, // fresh drive budget for the next player
      };

  return { shells, damage, endState, outcome: { gameOver, winner, winningTeam } };
}

// ─────────────────────────── hashing ───────────────────────────
/** Deterministic fingerprint (FNV-1a) over terrain + tanks + turn + wind. */
export function stateHash(state: GameState): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  // Sample terrain every 8 columns — enough to catch desync cheaply.
  for (let x = 0; x < state.terrain.length; x += 8) mix(state.terrain[x]);
  for (const t of state.tanks) {
    mix(t.x);
    mix(t.health);
    mix(t.alive ? 1 : 0);
  }
  mix(state.turn);
  mix(Math.round(state.wind * 100));
  mix(state.movesLeft);
  mix(state.moveCount);
  return (h >>> 0).toString(16).padStart(8, "0");
}
