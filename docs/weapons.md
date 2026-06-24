# TankDawgs arsenal

ShellShock Live / Pocket Tanks–style weapons. Every weapon is distinct across
six axes so no two feel alike:

- **Affect range** — `blastRadius`, the splash size (pinpoint → apocalyptic)
- **Muzzle velocity** — `velocityScale`, how flat/fast vs heavy/lofty it flies
- **Knockback** — `knockback`, how far the blast shoves a surviving tank
- **Damage / crater** — `maxDamage` (tuned to role) / `digFactor`
- **Behaviour** — `kind`: single · fan · salvo · cluster · mirv · roller · napalm
- **Scarcity** — `ammo`, limited rounds per game (the Shell is the only unlimited
  weapon)

Defined in [`packages/engine/src/weapons.ts`](../packages/engine/src/weapons.ts);
the picker, engine and renderer all read this registry.

| Weapon | Behaviour | Blast | Dmg | Vel | Knock | Ammo | Signature |
|---|---|---:|---:|---:|---:|---:|---|
| **Shell** | single | 30 | 30 | 1.15 | 0.8 | ∞ | Fast, flat all-rounder; the unlimited fallback |
| **Big Shot** | single | 60 | 48 | 0.82 | **2.2** | 4 | Heavy lob, huge crater, hammers a tank back |
| **Sniper** | single | 16 | **70** | 1.35 | 0.35 | 5 | Hyper-flat, pinpoint, brutal direct hit, barely a nudge |
| **Railgun** | salvo ×3 | 12 | 24 | **1.55** | 0.3 | 3 | **Rapid-fires** three hyper-velocity slugs at stepped power |
| **Tri-Shot** | fan ×3 | 24 | 20 | 1.1 | 0.6 | 4 | Three pellets in a tight angled fan |
| **Carpet Bomb** | fan ×6 | 22 | 16 | 1.0 | 0.5 | 3 | Wide fan that blankets a stretch of ground |
| **Cluster Bomb** | cluster ×5 | 22 | 15 | 1.0 | 0.5 | 3 | Splits into 5 bomblets on impact |
| **MIRV** | mirv ×4 | 32 | 24 | 1.0 | 0.6 | 2 | Splits into 4 warheads at the apex |
| **Hydra MIRV** | mirv ×6 | 26 | 18 | 1.0 | 0.5 | 2 | Six warheads rain from the apex |
| **Roller** | roller | 38 | 40 | 0.95 | 1.0 | 3 | Lands, rolls downhill, then blows |
| **Jackhammer** | single | 30 | 16 | 1.0 | **3.6** | 3 | Light damage, colossal knockback — punts a tank across a hill |
| **Napalm** | napalm ×6 | 24 | 13 | 1.0 | 0.3 | 3 | Lays a **burning strip that keeps blazing** after the hit |
| **Inferno** | single | 50 | 46 | 0.9 | 1.4 | 2 | One enormous concentrated fireball |
| **Cryoblast** | single | 46 | 32 | 1.0 | 0.7 | 3 | Frost burst — cold splash, shallow crater |
| **Digger** | single | **66** | 14 | 0.95 | 0.4 | 3 | Terraformer; carves deep, light damage |
| **Tactical Nuke** | single | **92** | 75 | 0.85 | 2.6 | **1** | Flattens the battlefield (and a full-screen flash) |

## Ammo

Every weapon except the **Shell** is limited per game — stronger/wider weapons
get fewer rounds (Nuke: 1, MIRVs/Inferno: 2, most: 3–5). Counts are tracked
per seat in `GameState.ammo[seat][weaponId]`, decremented as that seat fires,
and enforced by `validateShot`. The weapon picker shows each weapon's remaining
count (`×N`, or `∞` for the Shell), disables depleted ones, and auto-falls back
to the Shell if your selection runs dry.

## Recognisable rounds in flight

`style.shellShape` gives the heavy hitters a distinct, heading-oriented
silhouette so you can read an incoming round on sight:

- **Shell** & most weapons — a bright round ball
- **Big Shot** — a fat iron round with a tail fin (`heavy`)
- **Sniper** / **Railgun** — a slender needle with a white-hot tip (`dart`)
- **Jackhammer** — a blocky industrial piston (`piston`)
- **Digger** — a grooved auger cone (`drill`)
- **Tactical Nuke** — a finned missile with a red nose and warning halo (`warhead`)

## Explosion FX

Pocket Tanks-style: a bright, saturated bloom that pops out fast over a
white-hot core (drawn additively), plus an expanding shockwave ring and
flavour-specific particles. `style.fx` picks the particle style: `blast`
(debris + smoke), `fire` (embers; Napalm adds **lingering flames**), `dirt`
(chunks + dust), `spark` (fast glowing sparks), `plasma` (electric cyan + double
ring), `frost` (icy shards + mist). Nuke-class hits add a full-screen flash.
Blast size, shockwave and particle counts all scale with `blastRadius`.

## Ideas for next time

- **Cross-turn burning ground** — make Napalm's fire deal damage to tanks
  standing in it on later turns (needs persistent terrain-fire state).
- **Ammo crates / resupply**, weapon shop between rounds, or per-weapon cost.
- **Tracer / guided** rounds, **teleport**, **shield**, **dirt ball** (additive
  terrain) — all fit the registry shape.
