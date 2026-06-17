import type { Weapon } from "./types.js";

/**
 * The starting arsenal. ShellShock Live ships 400+ weapons; this is a compact,
 * representative set across the classic archetypes — the registry shape scales
 * to any number by adding entries (id, blast, damage, pellets, dig).
 */
export const WEAPONS: Record<string, Weapon> = {
  shell: {
    id: "shell",
    name: "Shell",
    blurb: "Reliable all-rounder.",
    blastRadius: 34,
    maxDamage: 34,
    pellets: 1,
    spreadDeg: 0,
    digFactor: 1,
  },
  bigshot: {
    id: "bigshot",
    name: "Big Shot",
    blurb: "Wide blast, big crater.",
    blastRadius: 56,
    maxDamage: 46,
    pellets: 1,
    spreadDeg: 0,
    digFactor: 1.15,
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "Tiny blast, brutal on a direct hit.",
    blastRadius: 18,
    maxDamage: 62,
    pellets: 1,
    spreadDeg: 0,
    digFactor: 0.6,
  },
  tri: {
    id: "tri",
    name: "Tri-Shot",
    blurb: "Three pellets in a tight fan.",
    blastRadius: 26,
    maxDamage: 22,
    pellets: 3,
    spreadDeg: 9,
    digFactor: 0.8,
  },
  digger: {
    id: "digger",
    name: "Digger",
    blurb: "Carves terrain; light damage.",
    blastRadius: 64,
    maxDamage: 16,
    pellets: 1,
    spreadDeg: 0,
    digFactor: 1.6,
  },
};

export const WEAPON_LIST: Weapon[] = Object.values(WEAPONS);

export const DEFAULT_WEAPON = "shell";

export function weaponById(id: string): Weapon {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
}
