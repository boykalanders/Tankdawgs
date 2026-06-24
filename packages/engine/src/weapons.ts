import type { Weapon } from "./types.js";

/**
 * The arsenal — ShellShock Live / Pocket Tanks flavoured. Each weapon layers a
 * behaviour (`kind`) and a visual style on top of the shared ballistics, and is
 * deliberately distinct across six axes so no two feel alike:
 *
 *   • affect range — `blastRadius`: pinpoint (Railgun 12) … apocalyptic (Nuke 92)
 *   • muzzle velocity — `velocityScale`: heavy lob (Big Shot 0.82) … hyper-flat
 *     (Railgun 1.55)
 *   • knockback — `knockback`: barely nudges (Sniper 0.35) … launches the tank
 *     across the field (Jackhammer 3.6)
 *   • damage / crater — `maxDamage` (tuned to role) / `digFactor`
 *   • behaviour — `kind`: single · fan · salvo · cluster · mirv · roller · napalm
 *   • scarcity — `ammo`: every weapon is limited per game EXCEPT the Shell, which
 *     is the unlimited fallback. Stronger / wider weapons get fewer rounds.
 *
 * `shellShape` gives the named heavy hitters a recognisable in-flight silhouette
 * so you can read an incoming round on sight. Add entries freely — the engine,
 * picker and renderer all read this registry.
 */
export const WEAPONS: Record<string, Weapon> = {
  shell: {
    id: "shell",
    name: "Shell",
    blurb: "Unlimited, fast, flat all-rounder. Tight blast, light kick.",
    kind: "single",
    blastRadius: 30,
    maxDamage: 30,
    digFactor: 0.9,
    count: 1,
    spreadDeg: 0,
    velocityScale: 1.15,
    knockback: 0.8,
    // No `ammo` → unlimited.
    style: { shell: "#ffe9a8", trail: "#ffd36a", burst: "#ffcf6b", shellRadius: 4, shellShape: "round", fx: "blast", smoke: "#6b6256" },
  },
  bigshot: {
    id: "bigshot",
    name: "Big Shot",
    blurb: "Heavy lobbed round. Huge crater, hammers a tank back hard.",
    kind: "single",
    blastRadius: 60,
    maxDamage: 48,
    digFactor: 1.35,
    count: 1,
    spreadDeg: 0,
    velocityScale: 0.82,
    knockback: 2.2,
    ammo: 4,
    style: { shell: "#ffb347", trail: "#ff8c42", burst: "#ff7a33", shellRadius: 7.5, shellShape: "heavy", fx: "blast", smoke: "#4a3a2a" },
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "Hyper-flat, pinpoint blast, brutal direct hit. Barely a nudge.",
    kind: "single",
    blastRadius: 16,
    maxDamage: 70,
    digFactor: 0.5,
    count: 1,
    spreadDeg: 0,
    velocityScale: 1.35,
    knockback: 0.35,
    ammo: 5,
    style: { shell: "#bdf0ff", trail: "#7fd8ff", burst: "#dff6ff", shellRadius: 3, shellShape: "dart", fx: "spark", smoke: "#9fb6c4" },
  },
  railgun: {
    id: "railgun",
    name: "Railgun",
    blurb: "Rapid-fires three hyper-velocity slugs at stepped power.",
    kind: "salvo",
    blastRadius: 12,
    maxDamage: 24,
    digFactor: 0.4,
    count: 3,
    spreadDeg: 0,
    powerSpread: 8,
    velocityScale: 1.55,
    knockback: 0.3,
    ammo: 3,
    style: { shell: "#aef6ff", trail: "#39d6ff", burst: "#d8ffff", shellRadius: 2.6, shellShape: "dart", fx: "plasma", smoke: "#7fd8ff" },
  },
  tri: {
    id: "tri",
    name: "Tri-Shot",
    blurb: "Three pellets in a tight angled fan.",
    kind: "fan",
    blastRadius: 24,
    maxDamage: 20,
    digFactor: 0.8,
    count: 3,
    spreadDeg: 9,
    velocityScale: 1.1,
    knockback: 0.6,
    ammo: 4,
    style: { shell: "#ffe9a8", trail: "#ffd36a", burst: "#ffcf6b", shellRadius: 3.5, shellShape: "round", fx: "spark", smoke: "#6b6256" },
  },
  carpet: {
    id: "carpet",
    name: "Carpet Bomb",
    blurb: "Six bomblets in a wide fan — blankets a stretch of ground.",
    kind: "fan",
    blastRadius: 22,
    maxDamage: 16,
    digFactor: 0.7,
    count: 6,
    spreadDeg: 26,
    velocityScale: 1,
    knockback: 0.5,
    ammo: 3,
    style: { shell: "#e9d18a", trail: "#c8a85a", burst: "#ffcf6b", shellRadius: 4, shellShape: "round", fx: "dirt", smoke: "#5a4a36" },
  },
  cluster: {
    id: "cluster",
    name: "Cluster Bomb",
    blurb: "Splits into 5 bomblets on impact.",
    kind: "cluster",
    blastRadius: 22,
    maxDamage: 15,
    digFactor: 0.7,
    count: 5,
    spreadDeg: 0,
    knockback: 0.5,
    ammo: 3,
    style: { shell: "#d6ff8a", trail: "#a7e34a", burst: "#c6ff5e", shellRadius: 5, shellShape: "round", fx: "blast", smoke: "#5e6b3a" },
  },
  mirv: {
    id: "mirv",
    name: "MIRV",
    blurb: "Splits into 4 warheads at the apex.",
    kind: "mirv",
    blastRadius: 32,
    maxDamage: 24,
    digFactor: 1,
    count: 4,
    spreadDeg: 0,
    knockback: 0.6,
    ammo: 2,
    style: { shell: "#ff9de2", trail: "#ff5fc4", burst: "#ff6fd0", shellRadius: 5, shellShape: "round", fx: "spark", smoke: "#a35a8e" },
  },
  hydra: {
    id: "hydra",
    name: "Hydra MIRV",
    blurb: "Six warheads rain down from the apex.",
    kind: "mirv",
    blastRadius: 26,
    maxDamage: 18,
    digFactor: 0.9,
    count: 6,
    spreadDeg: 0,
    knockback: 0.5,
    ammo: 2,
    style: { shell: "#c9a8ff", trail: "#9a6cff", burst: "#b98cff", shellRadius: 4.5, shellShape: "round", fx: "spark", smoke: "#6a4aa3" },
  },
  roller: {
    id: "roller",
    name: "Roller",
    blurb: "Lands, then rolls downhill before it blows.",
    kind: "roller",
    blastRadius: 38,
    maxDamage: 40,
    digFactor: 0.9,
    count: 1,
    spreadDeg: 0,
    velocityScale: 0.95,
    knockback: 1,
    ammo: 3,
    style: { shell: "#cdd2da", trail: "#9aa3af", burst: "#ffcf6b", shellRadius: 5.5, shellShape: "round", fx: "dirt", smoke: "#54504a" },
  },
  jackhammer: {
    id: "jackhammer",
    name: "Jackhammer",
    blurb: "Light damage, colossal knockback — punts a tank clear across a hill.",
    kind: "single",
    blastRadius: 30,
    maxDamage: 16,
    digFactor: 0.6,
    count: 1,
    spreadDeg: 0,
    velocityScale: 1,
    knockback: 3.6,
    ammo: 3,
    style: { shell: "#ffd27f", trail: "#ff9f4a", burst: "#ffe1a0", shellRadius: 5.5, shellShape: "piston", fx: "blast", smoke: "#4a4036" },
  },
  napalm: {
    id: "napalm",
    name: "Napalm",
    blurb: "Lays a burning strip that keeps blazing after the hit.",
    kind: "napalm",
    blastRadius: 24,
    maxDamage: 13,
    digFactor: 0.4,
    count: 6,
    spreadDeg: 0,
    knockback: 0.3,
    ammo: 3,
    style: { shell: "#ff7b3a", trail: "#ff5a1f", burst: "#ff8c1a", shellRadius: 4.5, shellShape: "round", fx: "fire", smoke: "#2a2420", lingerFire: true },
  },
  inferno: {
    id: "inferno",
    name: "Inferno",
    blurb: "One enormous fireball — concentrated, immediate devastation.",
    kind: "single",
    blastRadius: 50,
    maxDamage: 46,
    digFactor: 0.7,
    count: 1,
    spreadDeg: 0,
    velocityScale: 0.9,
    knockback: 1.4,
    ammo: 2,
    style: { shell: "#ff5a2a", trail: "#ff3a10", burst: "#ff6a12", shellRadius: 6, shellShape: "round", fx: "fire", smoke: "#241c18" },
  },
  cryo: {
    id: "cryo",
    name: "Cryoblast",
    blurb: "A bursting frost charge — cold splash, shallow crater.",
    kind: "single",
    blastRadius: 46,
    maxDamage: 32,
    digFactor: 0.5,
    count: 1,
    spreadDeg: 0,
    velocityScale: 1,
    knockback: 0.7,
    ammo: 3,
    style: { shell: "#dff4ff", trail: "#a9e2ff", burst: "#eafaff", shellRadius: 5, shellShape: "round", fx: "frost", smoke: "#bfe6f5" },
  },
  digger: {
    id: "digger",
    name: "Digger",
    blurb: "Terraforms the battlefield; carves deep, light damage.",
    kind: "single",
    blastRadius: 66,
    maxDamage: 14,
    digFactor: 1.8,
    count: 1,
    spreadDeg: 0,
    velocityScale: 0.95,
    knockback: 0.4,
    ammo: 3,
    style: { shell: "#c9a76a", trail: "#a8854a", burst: "#b98a4a", shellRadius: 6, shellShape: "drill", fx: "dirt", smoke: "#4a3c2a" },
  },
  nuke: {
    id: "nuke",
    name: "Tactical Nuke",
    blurb: "Enormous blast radius. Flattens the battlefield and everyone on it.",
    kind: "single",
    blastRadius: 92,
    maxDamage: 75,
    digFactor: 1.5,
    count: 1,
    spreadDeg: 0,
    velocityScale: 0.85,
    knockback: 2.6,
    ammo: 1,
    style: { shell: "#fff0a0", trail: "#ffd24a", burst: "#fff3c0", shellRadius: 7, shellShape: "warhead", fx: "blast", smoke: "#3a342c" },
  },
};

export const WEAPON_LIST: Weapon[] = Object.values(WEAPONS);

export const DEFAULT_WEAPON = "shell";

export function weaponById(id: string): Weapon {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
}

/** Fresh per-seat ammo inventory for a new game: every limited weapon at its
 *  starting count. Unlimited weapons (the Shell) are omitted. */
export function initialAmmo(): Record<string, number> {
  const ammo: Record<string, number> = {};
  for (const w of WEAPON_LIST) if (w.ammo != null) ammo[w.id] = w.ammo;
  return ammo;
}
