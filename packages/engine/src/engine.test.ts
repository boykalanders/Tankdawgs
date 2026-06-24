import { describe, it, expect } from "vitest";
import {
  createInitialState,
  driveTank,
  simulateShot,
  stateHash,
  validateShot,
  seedFromString,
  terrainAt,
  MOVES_PER_TURN,
  WORLD_WIDTH,
  type GameState,
  type ShotInput,
} from "./index.js";

const init = (players = 2, seed = seedFromString("TD-test")): GameState =>
  createInitialState({ players, seed });

describe("artillery engine — setup", () => {
  it("builds a battlefield with N tanks on the surface, seat 0 to move", () => {
    const s = init(4);
    expect(s.tanks).toHaveLength(4);
    expect(s.terrain).toHaveLength(WORLD_WIDTH);
    expect(s.turn).toBe(0);
    expect(s.gameOver).toBe(false);
    expect(s.tanks.every((t) => t.alive && t.health === 100)).toBe(true);
    // Tanks are spread left-to-right.
    for (let i = 1; i < s.tanks.length; i++) {
      expect(s.tanks[i].x).toBeGreaterThan(s.tanks[i - 1].x);
    }
  });

  it("is deterministic from a seed", () => {
    const a = createInitialState({ players: 3, seed: 12345 });
    const b = createInitialState({ players: 3, seed: 12345 });
    expect(stateHash(a)).toBe(stateHash(b));
    expect(createInitialState({ players: 3, seed: 999 }).terrain).not.toEqual(a.terrain);
  });
});

describe("artillery engine — validation", () => {
  it("rejects bad angle/power/weapon", () => {
    const s = init();
    expect(validateShot(s, { angle: -5, power: 50, weaponId: "shell" }).ok).toBe(false);
    expect(validateShot(s, { angle: 200, power: 50, weaponId: "shell" }).ok).toBe(false);
    expect(validateShot(s, { angle: 45, power: 0, weaponId: "shell" }).ok).toBe(false);
    expect(validateShot(s, { angle: 45, power: 50, weaponId: "nope" }).ok).toBe(true); // falls back to default
    expect(validateShot(s, { angle: 45, power: 50, weaponId: "shell" }).ok).toBe(true);
  });
});

/** First shell impact in a result (deterministic). */
const firstImpact = (res: ReturnType<typeof simulateShot>) =>
  res.shells.find((s) => s.impact)?.impact ?? null;

describe("artillery engine — firing", () => {
  it("produces a shell trajectory and advances the turn to the next alive seat", () => {
    const s = init(3);
    const shot: ShotInput = { angle: 60, power: 40, weaponId: "shell" };
    const res = simulateShot(s, shot);
    expect(res.shells[0].path.length).toBeGreaterThan(2);
    expect(res.shells[0].weaponId).toBe("shell");
    expect(res.endState.moveCount).toBe(1);
    if (!res.endState.gameOver) expect(res.endState.turn).toBe(1);
    expect(res.endState.tanks[0].angle).toBe(60);
    expect(res.endState.tanks[0].power).toBe(40);
  });

  it("damages a tank caught in the blast", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 90, power: 30, weaponId: "bigshot" };
    const impact = firstImpact(simulateShot(structuredClone(s), shot));
    expect(impact).toBeTruthy();
    s.tanks[1].x = Math.round(impact!.x);

    const res = simulateShot(s, shot);
    const dmg = res.damage.find((d) => d.seat === 1);
    expect(dmg && dmg.amount > 0).toBe(true);
    expect(res.endState.tanks[1].health).toBeLessThan(100);
  });

  it("ends the game when only one tank remains", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 90, power: 30, weaponId: "bigshot" };
    const impact = firstImpact(simulateShot(structuredClone(s), shot));
    s.tanks[1].x = Math.round(impact!.x);
    s.tanks[1].health = 5;

    const res = simulateShot(s, shot);
    expect(res.outcome.gameOver).toBe(true);
    expect(res.outcome.winner).toBe(0);
    expect(res.endState.gameOver).toBe(true);
  });

  it("tri-shot fires three shells", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 70, power: 50, weaponId: "tri" });
    expect(res.shells).toHaveLength(3);
    expect(res.shells.every((sh) => sh.startStep === 0)).toBe(true);
  });

  it("cluster splits into bomblets that start after the parent lands", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 70, power: 55, weaponId: "cluster" });
    // 1 parent + 5 bomblets (if the parent landed on the board).
    expect(res.shells.length).toBeGreaterThan(1);
    const children = res.shells.filter((sh) => sh.startStep > 0);
    expect(children.length).toBe(5);
  });

  it("mirv splits into warheads at the apex", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 80, power: 70, weaponId: "mirv" });
    expect(res.shells.filter((sh) => sh.startStep > 0).length).toBe(4);
  });

  it("a low MIRV that hits terrain early still deploys 4 warheads without tunnelling", () => {
    const s = init(2);
    // A flat, low shot drives into the ground before reaching a clean apex.
    const res = simulateShot(s, { angle: 12, power: 30, weaponId: "mirv" });
    expect(res.shells.filter((sh) => sh.startStep > 0).length).toBe(4);
    // No projectile begins life buried below the surface.
    for (const sh of res.shells) {
      const p0 = sh.path[0];
      expect(p0.y).toBeLessThanOrEqual(terrainAt(res.endState, p0.x) + 2);
    }
  });

  it("a railgun salvo rapid-fires several slugs in a staggered burst", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 45, power: 55, weaponId: "railgun" });
    expect(res.shells).toHaveLength(3);
    // First slug leaves at once; the rest are staggered (a burst over time).
    const starts = res.shells.map((sh) => sh.startStep);
    expect(starts[0]).toBe(0);
    expect(new Set(starts).size).toBe(3); // each launches at a distinct time
    expect(Math.max(...starts)).toBeGreaterThan(0);
  });

  it("limits special-weapon ammo but leaves the normal Bullet unlimited", () => {
    const s = init(2);
    // The Bullet is the unlimited fallback — not tracked in the ammo map.
    expect(s.ammo[0].bullet).toBeUndefined();
    expect(validateShot(s, { angle: 45, power: 50, weaponId: "bullet" }).ok).toBe(true);
    // The Shell is now a limited artillery shell.
    expect(s.ammo[0].shell).toBe(3);
    // Nuke starts at 1 round; firing it spends it.
    expect(s.ammo[0].nuke).toBe(1);
    const res = simulateShot(s, { angle: 90, power: 50, weaponId: "nuke" });
    expect(res.endState.ammo[0].nuke).toBe(0);
    // Out of ammo → can't fire it again on that seat's turn.
    const depleted = { ...res.endState, turn: 0, gameOver: false };
    expect(validateShot(depleted, { angle: 90, power: 50, weaponId: "nuke" }).ok).toBe(false);
  });

  it("jackhammer pounds its impact several times in a staggered burst", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 80, power: 45, weaponId: "jackhammer" });
    // 1 landing + (count-1) follow-up blows, staggered after it lands.
    expect(res.shells).toHaveLength(4);
    const blows = res.shells.filter((sh) => sh.startStep > 0);
    expect(blows.length).toBe(3);
    expect(new Set(blows.map((sh) => sh.startStep)).size).toBe(3); // each blow is staggered
  });

  it("a side-on blast knocks a surviving tank away from the epicentre", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 80, power: 30, weaponId: "bigshot" };
    // Find a clean ground impact with the target parked far out of the blast.
    s.tanks[1].x = s.width - 5;
    const impact = firstImpact(simulateShot(structuredClone(s), shot));
    expect(impact).toBeTruthy();
    // Sit the target inside the 60px blast but clear of a direct hit, at full HP.
    const startX = Math.round(impact!.x) + 24;
    s.tanks[1].x = startX;
    s.tanks[1].health = 100;
    const res = simulateShot(s, shot);
    expect(res.endState.tanks[1].alive).toBe(true);
    expect(res.endState.tanks[1].x).toBeGreaterThan(startX); // shoved to the right
  });

  it("roller produces a single shell with a long (flight + roll) path", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 35, power: 60, weaponId: "roller" });
    expect(res.shells).toHaveLength(1);
    expect(res.shells[0].path.length).toBeGreaterThan(3);
  });

  it("drives the tank on turn up to MOVES_PER_TURN steps, then stops", () => {
    let s = init(2);
    expect(s.movesLeft).toBe(MOVES_PER_TURN);
    const startX = s.tanks[0].x;
    for (let i = 0; i < MOVES_PER_TURN; i++) s = driveTank(s, 1);
    expect(s.tanks[0].x).toBeGreaterThan(startX);
    expect(s.movesLeft).toBe(0);
    // No moves left → unchanged.
    const x = s.tanks[0].x;
    s = driveTank(s, 1);
    expect(s.tanks[0].x).toBe(x);
  });

  it("a fresh turn restores the drive budget", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 60, power: 40, weaponId: "shell" });
    if (!res.endState.gameOver) expect(res.endState.movesLeft).toBe(MOVES_PER_TURN);
  });

  it("assigns teams in 2v2 and ends when one team is wiped", () => {
    const s = createInitialState({ players: 4, seed: 7, teamSize: 2 });
    expect(s.teamSize).toBe(2);
    expect(s.tanks.map((t) => t.team)).toEqual([0, 0, 1, 1]);
    // Wipe team 1 (seats 2,3); team 0 still has seat 0 alive → game over, team 0.
    s.tanks[1].alive = false;
    s.tanks[2].alive = false;
    s.tanks[3].health = 4;
    s.tanks[3].x = s.tanks[0].x + 24; // sit the last enemy next to seat 0
    // Seat 0 fires straight up onto seat 3.
    const probe = simulateShot(structuredClone(s), { angle: 90, power: 30, weaponId: "bigshot" });
    const impact = probe.shells.find((sh) => sh.impact)?.impact;
    s.tanks[3].x = Math.round(impact!.x);
    const res = simulateShot(s, { angle: 90, power: 30, weaponId: "bigshot" });
    expect(res.outcome.gameOver).toBe(true);
    expect(res.outcome.winningTeam).toBe(0);
  });

  it("a 2v2 is not over while both teams have a survivor", () => {
    const s = createInitialState({ players: 4, seed: 7, teamSize: 2 });
    // Kill one tank from each team — both teams still have one alive.
    s.tanks[1].alive = false;
    s.tanks[3].alive = false;
    const res = simulateShot(s, { angle: 90, power: 5, weaponId: "shell" });
    expect(res.outcome.gameOver).toBe(false);
  });

  it("re-simulates identically on a copy (server/client determinism)", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 55, power: 62, weaponId: "cluster" };
    const a = simulateShot(s, shot);
    const b = simulateShot(structuredClone(s), shot);
    expect(stateHash(a.endState)).toBe(stateHash(b.endState));
    expect(a.shells.length).toBe(b.shells.length);
  });
});
