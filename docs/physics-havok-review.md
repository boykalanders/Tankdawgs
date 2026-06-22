# Physics engine review — is Havok a good fit for TankDawgs?

**Short answer: No — not for the game as it exists today.** Keep the bespoke
deterministic integrator in `packages/engine`. Havok is a heavyweight 3D
rigid‑body engine; this is a 2D, turn‑based, **lockstep‑deterministic** artillery
game. The one property the whole architecture depends on — *bit‑identical results
on the server and the client* — is the very thing a general‑purpose float physics
engine does **not** give you for free. Details below, including when Havok *would*
make sense.

---

## What TankDawgs actually needs from "physics"

From `packages/engine` and the README:

- **One projectile at a time** (a handful for cluster/MIRV), following a ballistic
  arc: muzzle velocity → gravity + quadratic air drag → impact. ~point‑mass.
- **A 1‑D heightmap terrain** (`terrain[x]`), destructible by **circular crater
  carving**. No rigid bodies, no stacking, no constraints/joints.
- **Blast‑falloff damage + knockback** on impact.
- **Determinism**: the same shot must resolve to the same terrain, damage and
  trajectory on the authoritative server *and* every client. There is an explicit
  `stateHash()` desync check and a determinism unit test. The simulation uses a
  seeded LCG (no `Math.random`/`Date.now`) precisely to guarantee this.

The current engine is ~500 lines, dependency‑free, and trivially deterministic.

## Why Havok is a poor fit here

1. **Dimensionality mismatch.** Havok Physics is a 3‑D rigid‑body solver (contacts,
   constraints, stacking, ragdolls, vehicles). We simulate a single point‑mass
   parabola over a 1‑D heightfield. ~99% of the engine would sit unused while we
   pay its full cost.

2. **Determinism is the dealbreaker.** The game is lockstep: server and client run
   the *same* sim and compare hashes. General‑purpose float physics engines —
   Havok, PhysX, even Rapier/Box2D in float mode — **do not contractually
   guarantee cross‑platform/cross‑build determinism**. Havok's WASM build *might*
   be deterministic if the exact same module runs with an identical fixed timestep
   and call order on both sides (WASM IEEE‑754 float ops are well‑defined), but
   Havok's internal broadphase ordering, SIMD and threading make this fragile and
   unverified across a Node server and a browser client. We'd be trading a
   *guaranteed* property for a *hope‑it‑holds* one — and any desync corrupts the
   authoritative, **wagered** outcome.

3. **Bundle + startup cost.** The Havok WASM core is ~1–2 MB. Shipping that to the
   browser (and loading it in the Node server) to replace a 500‑line integrator is
   a large regression in load time and memory for no gameplay gain.

4. **Destructible terrain isn't its job.** Our heightmap + crater carve is a few
   lines and cheap. Destructible terrain in a rigid‑body engine means voxels or
   runtime convex decomposition — complex, and not something Havok hands you.

5. **No multi‑body world to solve.** Turn‑based, ≤ a few shells in flight, no
   persistent interacting bodies. The entire reason to adopt a real solver
   (contacts/constraints/stacking) is absent.

## When Havok *would* make sense

To be fair to the question — Havok becomes attractive if the game pivots:

- **Real‑time 3‑D** tanks: driving hulls with suspension, tracks, collisions
  between many vehicles, ragdoll/wreck tumbling, debris and rubble piles that
  interact and settle.
- **Physically simulated wreckage** as a core mechanic (not cosmetic).
- **Determinism dropped** — e.g. a server that replays its own authoritative sim
  and streams *results* to clients, instead of lockstep client re‑simulation.

If/when that happens, evaluate Havok **via Babylon.js** (the realistic web path)
against lighter, more web‑native options — **Rapier** (Rust→WASM, has an explicit
deterministic mode and a smaller footprint) and **Jolt** (modern, WASM). For a
*networked, deterministic* title, Rapier's determinism story is more explicitly
supported than Havok's.

## Recommended path for "more realism" now

Stay in the deterministic engine and extend the cheap analytic model — this is
where we already added quadratic **air drag**, a real **muzzle velocity**, and
blast **knockback**:

- **Per‑weapon ballistic coefficient / mass** → heavy shells punch through wind and
  drop less; light shells decelerate fast. (1 number per weapon.)
- **Wind as a moving air‑mass** folded into drag, so supersonic shells shrug off
  wind while slow lobs drift (more physical than the current additive wind nudge).
- **Ricochet / skip** off shallow terrain angles; **spin/Magnus** drift (optional).
- **Cosmetic‑only physics layer (client side, non‑authoritative):** if you want
  flying debris, smoke and tumbling wreckage, run a small 2‑D physics/particle
  system (e.g. matter.js or Rapier2D) **purely for visuals**, while the
  authoritative result stays in the deterministic engine. This buys AAA‑looking
  juice with **zero** desync risk — the simulated debris never feeds back into
  game state.

### Bottom line

| | Custom engine (today) | Havok |
|---|---|---|
| Fits 2‑D heightmap artillery | ✅ exactly | ❌ 3‑D rigid body |
| Guaranteed server/client determinism | ✅ by construction | ⚠️ fragile / unverified |
| Bundle + server cost | ✅ ~0 | ❌ ~1–2 MB WASM both sides |
| Destructible terrain | ✅ trivial | ❌ complex |
| Realism headroom | ✅ extend analytically | ✅ (but unused here) |

Keep the custom deterministic engine. Reach for a physics engine only on a 3‑D
real‑time rewrite — and even then weigh Rapier/Jolt before Havok for a networked,
deterministic game.
