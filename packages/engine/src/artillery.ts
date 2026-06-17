import type {
  DamageEvent,
  GameState,
  Point,
  ShotInput,
  ShotResult,
  Tank,
} from "./types.js";
import { weaponById, DEFAULT_WEAPON } from "./weapons.js";

// ─────────────────────────── world constants ───────────────────────────
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 600;

const GRAVITY = 0.32; // per step², downward (y grows down)
const POWER_SCALE = 0.2; // power 0–100 → speed 0–20 units/step
const WIND_ACCEL = 0.03; // horizontal accel per step at |wind| = 1
const DT = 1;
const MAX_STEPS = 3000;
const MUZZLE_RISE = 16; // launch this far above the tank's surface
const TANK_BODY = 8; // half-height of a tank body (for hit/centre)
const TANK_HIT_RADIUS = 14; // a pellet striking within this hits the tank
const MIN_GROUND = Math.round(WORLD_HEIGHT * 0.28); // highest a peak can be
const MAX_GROUND = Math.round(WORLD_HEIGHT * 0.92); // lowest a valley can be

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
  width?: number;
  height?: number;
}

/** Fresh battlefield: hills + N tanks spread across the width, seat 0 to move. */
export function createInitialState(opts: InitOptions): GameState {
  const width = opts.width ?? WORLD_WIDTH;
  const height = opts.height ?? WORLD_HEIGHT;
  const n = Math.max(2, opts.players);
  const terrain = generateTerrain(width, opts.seed);

  const margin = Math.round(width * 0.08);
  const span = width - margin * 2;
  const tanks: Tank[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? Math.round(width / 2) : Math.round(margin + (span * i) / (n - 1));
    tanks.push({
      seat: i,
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
    turn: 0,
    wind: windFromSeed(windSeed),
    seed: windSeed,
    gameOver: false,
    winner: null,
    moveCount: 0,
  };
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

/** Simulate one pellet from `origin`; returns its polyline and impact (or null
 *  if it flew off the left/right edges). Reads the live (mutating) terrain. */
function simulatePellet(
  origin: Point,
  angleDeg: number,
  power: number,
  state: GameState,
  terrain: number[]
): { path: Point[]; impact: Point | null } {
  const rad = (angleDeg * Math.PI) / 180;
  const speed = power * POWER_SCALE;
  let vx = Math.cos(rad) * speed;
  let vy = -Math.sin(rad) * speed; // up is negative y
  let x = origin.x;
  let y = origin.y;
  const path: Point[] = [{ x, y }];
  const { width, turn } = state;

  for (let step = 0; step < MAX_STEPS; step++) {
    vx += state.wind * WIND_ACCEL * DT;
    vy += GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    path.push({ x, y });

    if (x < 0 || x >= width) return { path, impact: null }; // off the sides
    // Tank hit (ignore the shooter for the first stretch so it doesn't self-clip
    // at the muzzle).
    for (const t of state.tanks) {
      if (!t.alive) continue;
      if (t.seat === turn && step < 4) continue;
      const c = tankCentre(t, terrain, width);
      if ((x - c.x) ** 2 + (y - c.y) ** 2 <= TANK_HIT_RADIUS * TANK_HIT_RADIUS) {
        return { path, impact: { x, y } };
      }
    }
    // Ground hit.
    if (y >= terrain[clampX(x, width)]) return { path, impact: { x, y } };
    if (y >= WORLD_HEIGHT) return { path, impact: { x, y: WORLD_HEIGHT } };
  }
  return { path, impact: { x, y } };
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

  const trajectories: Point[][] = [];
  const impacts: Point[] = [];
  const dealt = new Map<number, number>(); // seat → damage

  for (let p = 0; p < weapon.pellets; p++) {
    const offset =
      weapon.pellets > 1
        ? (p - (weapon.pellets - 1) / 2) * (weapon.spreadDeg / (weapon.pellets - 1))
        : 0;
    const { path, impact } = simulatePellet(origin, shot.angle + offset, shot.power, state, terrain);
    trajectories.push(path);
    if (!impact) continue;
    impacts.push(impact);

    // Damage every alive tank within the blast (falloff to 0 at the edge),
    // using centres BEFORE this pellet carves, then carve the crater.
    for (const t of state.tanks) {
      if (!t.alive) continue;
      const c = tankCentre(t, terrain, width);
      const dist = Math.hypot(impact.x - c.x, impact.y - c.y);
      if (dist <= weapon.blastRadius) {
        const dmg = weapon.maxDamage * (1 - dist / weapon.blastRadius);
        dealt.set(t.seat, (dealt.get(t.seat) ?? 0) + dmg);
      }
    }
    carve(terrain, width, impact.x, impact.y, weapon.blastRadius, weapon.digFactor);
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
  // Record the shooter's aim.
  tanks[state.turn] = { ...tanks[state.turn], angle: shot.angle, power: shot.power };

  const aliveAfter = tanks.filter((t) => t.alive);
  const gameOver = aliveAfter.length <= 1;
  const winner = gameOver ? (aliveAfter.length === 1 ? aliveAfter[0].seat : null) : null;

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
      };

  return { trajectories, impacts, damage, endState, outcome: { gameOver, winner } };
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
  mix(state.moveCount);
  return (h >>> 0).toString(16).padStart(8, "0");
}
