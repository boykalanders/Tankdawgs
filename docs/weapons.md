# TankDawgs arsenal

ShellShock Live / Pocket Tanks–style weapons. Every weapon is distinct across
five axes so no two feel alike:

- **Affect range** — `blastRadius`, the splash size (pinpoint → apocalyptic)
- **Muzzle velocity** — `velocityScale`, how flat/fast vs heavy/lofty it flies
- **Knockback** — `knockback`, how far the blast shoves a surviving tank
- **Damage / crater** — `maxDamage` / `digFactor`
- **Behaviour** — `kind`: single · fan · salvo · cluster · mirv · roller · napalm

Defined in [`packages/engine/src/weapons.ts`](../packages/engine/src/weapons.ts);
the picker, engine and renderer all read this registry.

| Weapon | Behaviour | Blast | Dmg | Vel | Knock | Signature |
|---|---|---:|---:|---:|---:|---|
| **Shell** | single | 30 | 32 | 1.15 | 0.8 | Fast, flat all-rounder; tight blast, light kick |
| **Big Shot** | single | 60 | 50 | 0.82 | **2.2** | Heavy lob, huge crater, hammers a tank back |
| **Sniper** | single | 16 | **66** | 1.35 | 0.35 | Hyper-flat, pinpoint, brutal direct hit, barely a nudge |
| **Railgun** | salvo ×3 | 12 | 34 | **1.55** | 0.3 | Three hyper-velocity slugs at stepped power |
| **Tri-Shot** | fan ×3 | 24 | 22 | 1.1 | 0.6 | Three pellets in a tight angled fan |
| **Carpet Bomb** | fan ×6 | 22 | 18 | 1.0 | 0.5 | Wide fan that blankets a stretch of ground |
| **Cluster Bomb** | cluster ×5 | 22 | 14 | 1.0 | 0.5 | Splits into 5 bomblets on impact |
| **MIRV** | mirv ×4 | 32 | 24 | 1.0 | 0.6 | Splits into 4 warheads at the apex |
| **Hydra MIRV** | mirv ×6 | 26 | 20 | 1.0 | 0.5 | Six warheads rain from the apex |
| **Roller** | roller | 38 | 38 | 0.95 | 1.0 | Lands, rolls downhill, then blows |
| **Jackhammer** | single | 30 | 18 | 1.0 | **3.6** | Light damage, colossal knockback — punts a tank across a hill |
| **Napalm** | napalm ×6 | 24 | 12 | 1.0 | 0.3 | Lays a **burning strip that keeps blazing** after the hit |
| **Inferno** | single | 50 | 44 | 0.9 | 1.4 | One enormous concentrated fireball |
| **Cryoblast** | single | 46 | 30 | 1.0 | 0.7 | Frost burst — cold splash, shallow crater |
| **Digger** | single | **66** | 16 | 0.95 | 0.4 | Terraformer; carves deep, light damage |
| **Tactical Nuke** | single | **92** | 70 | 0.85 | 2.6 | Flattens the battlefield (and a full-screen flash) |

## What changed in this pass

- **Shell vs Big Shot are now clearly different.** Shell is the snappy, flat,
  low-recoil workhorse; Big Shot is a slow, heavy lob with a 2× crater and a big
  shove.
- **Napalm leaves fire.** It lays a wide, low-damage burning strip whose flames
  keep flickering and spitting embers for ~1.2s after impact — that lingering
  fire is its identity. **Inferno** is the opposite: one big, immediate fireball,
  no linger.
- **Railgun fires a salvo** — three hyper-velocity slugs on the same line at
  slightly different power, so they string out and land staggered.
- **Per-weapon knockback.** Some barely nudge (Sniper, Railgun, Napalm); some
  shove hard (Big Shot, Nuke); **Jackhammer** is a dedicated launcher that throws
  a tank across the terrain with almost no damage.

## Explosion FX flavours (renderer)

Each weapon's `style.fx` picks the impact particle style: `blast` (debris +
smoke + shockwave), `fire` (embers; Napalm adds lingering flames), `dirt`
(chunks + dust), `spark` (fast glowing sparks), `plasma` (electric cyan + double
ring), `frost` (icy shards + mist). Huge `blast` hits (Nuke) add a full-screen
flash. Blast size, shockwave and particle counts all scale with `blastRadius`.

## Ideas for next time

- **Cross-turn burning ground** — make Napalm's fire actually deal damage to
  tanks standing in it on later turns (needs a small amount of persistent
  terrain-fire state in the engine).
- **Tracer / guided** rounds, **teleport**, **shield**, **dirt ball** (additive
  terrain) — all fit the registry shape.
