/**
 * TankDawgs artillery engine — deterministic 2D turn-based artillery (ShellShock
 * Live / Pocket Tanks style). The same simulation runs on the server
 * (authoritative) and the client (animation), so a given shot always resolves to
 * the same terrain, damage and trajectory on both sides.
 */

/** A point in world space (origin top-left, y increases downward). */
export interface Point {
  x: number;
  y: number;
}

/** A single tank, owned by a seat (player index). */
export interface Tank {
  /** Seat index — also the player's position in the turn order. */
  seat: number;
  /** Column position along the terrain (world x). */
  x: number;
  /** 0–100; at 0 the tank is destroyed. */
  health: number;
  alive: boolean;
  /** Last aim — barrel angle in degrees: 0 = due east, 90 = straight up,
   *  180 = due west. */
  angle: number;
  /** Last power 0–100. */
  power: number;
}

/**
 * Authoritative game state. `terrain[x]` is the surface Y at column x: solid
 * ground exists for y ≥ terrain[x], sky above. A tank rests on the surface at
 * its column. Destructible — explosions lower the surface (raise terrain[x]).
 */
export interface GameState {
  width: number;
  height: number;
  /** Surface Y per column, length === width. */
  terrain: number[];
  tanks: Tank[];
  /** Seat whose turn it is (always an alive tank, unless gameOver). */
  turn: number;
  /** Horizontal wind, −1 (full west) … +1 (full east). Changes each turn. */
  wind: number;
  /** LCG state for deterministic wind progression. */
  seed: number;
  gameOver: boolean;
  /** Winning seat once gameOver (null on a mutual KO / draw). */
  winner: number | null;
  moveCount: number;
}

/** A fired shot: barrel angle, power, and the chosen weapon. */
export interface ShotInput {
  angle: number;
  power: number;
  weaponId: string;
}

/** Aggregated damage dealt to a seat by a shot. */
export interface DamageEvent {
  seat: number;
  amount: number;
  /** True if this hit reduced the tank to 0 (destroyed). */
  killed: boolean;
}

/** Full deterministic resolution of a shot. */
export interface ShotResult {
  /** One polyline per pellet (most weapons fire a single pellet). */
  trajectories: Point[][];
  /** Impact points (off-board fizzles excluded). */
  impacts: Point[];
  damage: DamageEvent[];
  endState: GameState;
  outcome: { gameOver: boolean; winner: number | null };
}

/** A weapon definition. The registry is intentionally small but extensible — the
 *  shape scales to a large arsenal (ShellShock-style) by adding entries. */
export interface Weapon {
  id: string;
  name: string;
  /** One-line description for the weapon picker. */
  blurb: string;
  /** Crater / blast radius in world units. */
  blastRadius: number;
  /** Max damage at the epicentre (falls off linearly to 0 at blastRadius). */
  maxDamage: number;
  /** Number of pellets fired in a small spread (1 for most weapons). */
  pellets: number;
  /** Total angular spread (degrees) across the pellets when pellets > 1. */
  spreadDeg: number;
  /** How much terrain the blast removes, as a multiple of blastRadius. */
  digFactor: number;
}
