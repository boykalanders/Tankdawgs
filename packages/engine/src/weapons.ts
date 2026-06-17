import type { Weapon } from "./types.js";

/**
 * The arsenal. Each weapon layers a behaviour (`kind`) and a visual style on top
 * of the shared ballistics. The registry shape scales to a large ShellShock-style
 * armoury by adding entries — the engine and renderer both read it.
 *
 *  • single  — one shell, one crater.
 *  • fan     — `count` pellets in a tight spread.
 *  • cluster — one shell that splits into `count` bomblets on impact.
 *  • mirv    — one shell that splits into `count` warheads at the apex.
 *  • roller  — one shell that rolls downhill along the terrain before exploding.
 *  • napalm  — one shell that spreads fire across the terrain on impact.
 */
export const WEAPONS: Record<string, Weapon> = {
  shell: {
    id: "shell",
    name: "Shell",
    blurb: "Reliable all-rounder.",
    kind: "single",
    blastRadius: 34,
    maxDamage: 34,
    digFactor: 1,
    count: 1,
    spreadDeg: 0,
    style: { shell: "#ffe9a8", trail: "#ffd36a", burst: "#ffcf6b", shellRadius: 4.5 },
  },
  bigshot: {
    id: "bigshot",
    name: "Big Shot",
    blurb: "Wide blast, big crater.",
    kind: "single",
    blastRadius: 56,
    maxDamage: 46,
    digFactor: 1.15,
    count: 1,
    spreadDeg: 0,
    style: { shell: "#ffb347", trail: "#ff8c42", burst: "#ff7a33", shellRadius: 6.5 },
  },
  sniper: {
    id: "sniper",
    name: "Sniper",
    blurb: "Tiny blast, brutal direct hit.",
    kind: "single",
    blastRadius: 18,
    maxDamage: 64,
    digFactor: 0.55,
    count: 1,
    spreadDeg: 0,
    style: { shell: "#bdf0ff", trail: "#7fd8ff", burst: "#dff6ff", shellRadius: 3 },
  },
  tri: {
    id: "tri",
    name: "Tri-Shot",
    blurb: "Three pellets in a tight fan.",
    kind: "fan",
    blastRadius: 26,
    maxDamage: 22,
    digFactor: 0.8,
    count: 3,
    spreadDeg: 9,
    style: { shell: "#ffe9a8", trail: "#ffd36a", burst: "#ffcf6b", shellRadius: 3.5 },
  },
  cluster: {
    id: "cluster",
    name: "Cluster Bomb",
    blurb: "Splits into 5 bomblets on impact.",
    kind: "cluster",
    blastRadius: 22,
    maxDamage: 14,
    digFactor: 0.7,
    count: 5,
    spreadDeg: 0,
    style: { shell: "#d6ff8a", trail: "#a7e34a", burst: "#c6ff5e", shellRadius: 5 },
  },
  mirv: {
    id: "mirv",
    name: "MIRV",
    blurb: "Splits into 4 warheads at the apex.",
    kind: "mirv",
    blastRadius: 34,
    maxDamage: 26,
    digFactor: 1,
    count: 4,
    spreadDeg: 0,
    style: { shell: "#ff9de2", trail: "#ff5fc4", burst: "#ff6fd0", shellRadius: 5 },
  },
  roller: {
    id: "roller",
    name: "Roller",
    blurb: "Lands, then rolls downhill before it blows.",
    kind: "roller",
    blastRadius: 40,
    maxDamage: 40,
    digFactor: 0.9,
    count: 1,
    spreadDeg: 0,
    style: { shell: "#cdd2da", trail: "#9aa3af", burst: "#ffcf6b", shellRadius: 5.5 },
  },
  napalm: {
    id: "napalm",
    name: "Napalm",
    blurb: "Spreads fire across the terrain.",
    kind: "napalm",
    blastRadius: 30,
    maxDamage: 18,
    digFactor: 0.5,
    count: 5,
    spreadDeg: 0,
    style: { shell: "#ff7b3a", trail: "#ff5a1f", burst: "#ff8c1a", shellRadius: 4.5 },
  },
  digger: {
    id: "digger",
    name: "Digger",
    blurb: "Carves terrain; light damage.",
    kind: "single",
    blastRadius: 64,
    maxDamage: 16,
    digFactor: 1.7,
    count: 1,
    spreadDeg: 0,
    style: { shell: "#c9a76a", trail: "#a8854a", burst: "#b98a4a", shellRadius: 6 },
  },
};

export const WEAPON_LIST: Weapon[] = Object.values(WEAPONS);

export const DEFAULT_WEAPON = "shell";

export function weaponById(id: string): Weapon {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON];
}
