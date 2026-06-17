# TankDawgs 🪖

Wagered **turn-based artillery** (ShellShock Live / Pocket Tanks style) for the
**Deputy Dawgs** ecosystem. Stake **$DDawgs**, calculate angle, power, wind and
trajectory, and blast the other tanks off the map. **Last tank standing takes
80% of the pot**; 10% to the company, 10% burned. NFT-gated — Deputy Dawgs
holders only.

The game is a **deterministic engine** (`packages/engine`) that runs on **both**
the server (authoritative) and the client (rendering/animation), so a given shot
always resolves to the same terrain, damage and trajectory on either side. The
economic system and workflow are shared with the PoolDawgs / GomokuDawgs
projects — only the game differs.

## The game

- **2–8 players** per battle: 1v1 duels up to 8-tank free-for-alls.
- Turn-based: on your turn set **angle (0–180°)**, **power (1–100%)** and a
  **weapon**, then fire. **Wind** pushes the shell east/west — read it before you
  shoot.
- **Destructible terrain** (heightmap) — explosions carve craters.
- **Last tank standing wins.** Resign or time out (per-turn clock) and your tank
  is destroyed.
- **Weapons** (`packages/engine/src/weapons.ts`): Shell, Big Shot, Sniper,
  Tri-Shot, Digger — a compact arsenal whose registry shape scales to a large
  ShellShock-style weapon list by adding entries.

## Why server-authoritative

Real money is staked, so **outcomes can never be decided by a player's browser**.
A trusted backend simulates every shot, enforces turns and the per-turn clock
(off-chain by design — there is no on-chain timer), and settles the result. On a
win it signs an **EIP-712 voucher** the winner self-redeems via
`claimRewardSigned` (settles AND pays the 80/10/10 split in one winner-paid tx —
no relayer gas); the operator's `finishGame` is a backstop.

## The wager (N-player escrow)

`packages/contracts/contracts/TankDawgs.sol` generalises the Dawgs escrow to N
players:

- `createGame(stake, maxPlayers, gameId)` — creator takes seat 0, escrows the
  stake (2 ≤ maxPlayers ≤ 8). NFT-gated.
- `joinGame(gameId)` — each joiner escrows the same stake; the game goes **active
  once the final seat fills**.
- `cancelGame(gameId)` — creator cancels a not-yet-full table; **every** joined
  player is refunded.
- Pot = `stake × players`. Winner: `claimRewardSigned(gameId, voucher)` →
  80% winner / 10% company / 10% burn. `ownerWithdrawUnpaid` sweeps an unclaimed
  pot after a timeout.
- Gate: holds the **TankDawgs membership pass** (TankDawgsNFT) OR a
  grandfathered **ChessDawgs NFT**.

## Layout

```
apps/web/           Next.js frontend — wallet gate, lobby (pick seats + stake),
                    battlefield canvas, practice range, leaderboard, profile
apps/server/        Authoritative game server — Socket.IO rooms, turn clock,
                    chain event listener, relayer (signs win vouchers)
packages/engine/    Deterministic artillery engine (terrain, ballistics, weapons)
packages/contracts/ TankDawgs.sol (N-player escrow, UUPS proxy) + Hardhat tests
packages/shared/    Types, socket event contracts, curated ABI, game codes
```

## Game codes

A code embeds the seat count: **`TD<N>-XXXXX`** (N = 2…8). The web mints the
code, the contract stores it verbatim, and the server seeds the terrain from the
gameId — so server and clients build the identical battlefield from the code
alone (`packages/shared/src/gamecode.ts`).

## Getting started

```bash
pnpm install
pnpm -r build          # engine → shared → server, compiles contracts
pnpm -r test           # engine, server, and contract tests
```

### Run locally (chain-less dev mode)

Leave `RPC_URL`/`CONTRACT_ADDRESS` empty in `apps/server/.env`:

```bash
pnpm --filter @tankdawgs/server dev          # game server
pnpm --filter @tankdawgs/web build && pnpm --filter @tankdawgs/web start
```

Open http://localhost:3000. The **Practice range** needs no server or wallet (a
local hot-seat battle). For multiplayer in dev mode, the first N distinct wallets
to open a `TD<N>-…` code become the players. The web runs chain-less until the
contracts are deployed and wired into `apps/web/lib/env.ts`.

### Deploy the contract

```bash
cd packages/contracts
cp .env.example .env   # fill RPC, deployer key, token/NFT/company addresses
pnpm deploy:sepolia    # (or deploy:mainnet)
```

After deploy, set the contract's `resultSigner` to the backend's signing address
(`setResultSigner`) and a low-privilege `operator` (`setOperator`). Wire the
addresses into `apps/web/lib/env.ts` (or `NEXT_PUBLIC_*`) and the server's
`CONTRACT_ADDRESS`.

### Wire the apps

- `apps/server/.env` — `RPC_URL`, `CONTRACT_ADDRESS`, `OPERATOR_PRIVATE_KEY`
  (or `OWNER_PRIVATE_KEY`); the signer's address must equal the contract's
  `resultSigner`.
- `apps/web/.env.local` — `NEXT_PUBLIC_TANKDAWGS_ADDRESS`,
  `NEXT_PUBLIC_DDAWGS_TOKEN_ADDRESS`, `NEXT_PUBLIC_TANKDAWGS_NFT_ADDRESS`,
  `NEXT_PUBLIC_CHESS_NFT_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID`,
  `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

## How a wagered battle flows

1. Player A: `approve` → `createGame(stake, maxPlayers, code)` (escrows, NFT-gated).
2. Players B…N: `approve` → `joinGame(code)`. The battle goes active when full.
3. All connect to the server room (wallet-signature login) and take turns. Each
   client sends `{angle, power, weaponId}`; the server simulates with the shared
   engine and broadcasts the trajectory + authoritative post-shot state; clients
   animate it.
4. Battle ends (last tank standing, resign, or turn-clock timeout) → the server
   signs an **EIP-712 win voucher**.
5. Winner calls **`claimRewardSigned(code, voucher)`** → 80/10/10 split in one tx.
   Unclaimed wins also surface on the **Profile** page.

## Status / roadmap

- **Not yet deployed** — `apps/web/lib/env.ts` addresses are null, so the app
  runs chain-less until you deploy and wire them in.
- Teams (vs. free-for-all), a larger weapon arsenal, weapon unlocks/levelling,
  and matchmaking polish are natural next steps — the engine, contract and lobby
  already support N players and an extensible weapon registry.
- Lobby/leaderboard stores are in-memory; swap for Postgres/Redis before scaling
  past one server instance.

## Ecosystem addresses (Ethereum mainnet)

| Contract | Address |
|---|---|
| $DDawgs ERC-20 (`rewardToken`) | `0x19f78a898f3e3c2f40c6E0CD2EE5545F549d5E99` |
| Gate NFT — ChessDawgs NFT (grandfather) | `0xf82E0cF5605101efE12689461c2bC9392BfDedEF` |
