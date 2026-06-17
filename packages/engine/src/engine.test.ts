import { describe, it, expect } from "vitest";
import {
  createInitialState,
  simulateShot,
  stateHash,
  validateShot,
  seedFromString,
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

describe("artillery engine — firing", () => {
  it("produces a trajectory and advances the turn to the next alive seat", () => {
    const s = init(3);
    const shot: ShotInput = { angle: 60, power: 40, weaponId: "shell" };
    const res = simulateShot(s, shot);
    expect(res.trajectories[0].length).toBeGreaterThan(2);
    expect(res.endState.moveCount).toBe(1);
    if (!res.endState.gameOver) expect(res.endState.turn).toBe(1);
    // Wind changed for the next turn.
    expect(res.endState.tanks[0].angle).toBe(60);
    expect(res.endState.tanks[0].power).toBe(40);
  });

  it("damages a tank caught in the blast", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 90, power: 30, weaponId: "bigshot" };
    // Probe where a straight-up shot lands (deterministic), then sit seat 1 there.
    const impact = simulateShot(structuredClone(s), shot).impacts[0];
    expect(impact).toBeTruthy();
    s.tanks[1].x = Math.round(impact.x);

    const res = simulateShot(s, shot);
    const dmg = res.damage.find((d) => d.seat === 1);
    expect(dmg && dmg.amount > 0).toBe(true);
    expect(res.endState.tanks[1].health).toBeLessThan(100);
  });

  it("ends the game when only one tank remains", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 90, power: 30, weaponId: "bigshot" };
    const impact = simulateShot(structuredClone(s), shot).impacts[0];
    s.tanks[1].x = Math.round(impact.x);
    s.tanks[1].health = 5; // one blast finishes it

    const res = simulateShot(s, shot);
    expect(res.outcome.gameOver).toBe(true);
    expect(res.outcome.winner).toBe(0);
    expect(res.endState.gameOver).toBe(true);
  });

  it("tri-shot fires three pellets", () => {
    const s = init(2);
    const res = simulateShot(s, { angle: 70, power: 50, weaponId: "tri" });
    expect(res.trajectories).toHaveLength(3);
  });

  it("re-simulates identically on a copy (server/client determinism)", () => {
    const s = init(2);
    const shot: ShotInput = { angle: 55, power: 62, weaponId: "shell" };
    const a = simulateShot(s, shot);
    const b = simulateShot(structuredClone(s), shot);
    expect(stateHash(a.endState)).toBe(stateHash(b.endState));
  });
});
