import type { Address } from "@tankdawgs/shared";

// Tolerate a SERVER_URL set without a scheme (e.g. "host.up.railway.app"):
// socket.io copes, but `fetch(SERVER_URL + "/…")` would treat it as a relative
// path. Prepend https:// when no scheme is present so both work.
const rawServerUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const SERVER_URL = /^https?:\/\//i.test(rawServerUrl)
  ? rawServerUrl
  : `https://${rawServerUrl}`;

// A real WalletConnect/Reown project id is 32 hex chars. Empty by default so
// the app falls back to injected wallets instead of throwing.
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

/** Active chain: Sepolia by default; set NEXT_PUBLIC_CHAIN_ID=1 for mainnet. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11155111;

interface NetworkContracts {
  name: string;
  poolDawgs: Address | null;
  ddawgsToken: Address | null;
  /** Mintable TankDawgs membership pass (the mint target). */
  poolDawgsNFT: Address | null;
  /** Grandfathered ChessDawgs NFT (informational; the gate ORs it in-contract). */
  chessDawgsNFT: Address | null;
}

/**
 * Dual-network address book. Sepolia is live (deployed by
 * `pnpm --filter @tankdawgs/contracts deploy:sepolia`). Mainnet knows the
 * existing $DDawgs token and ChessDawgs NFT; the TankDawgs proxy and the new
 * membership NFT are filled in once deployed there. Env vars override per key.
 */
const NETWORKS: Record<number, NetworkContracts> = {
  11155111: {
    name: "Sepolia",
    // N-player escrow (deployed 2026-06-17 by deploy:sepolia, mock token/NFT).
    // Server CONTRACT_ADDRESS must match. resultSigner = owner 0x9456…6B2.
    poolDawgs: "0x0382bde966f2B379E58614A00b01D069E6f2ae6F",
    ddawgsToken: "0xF30C8A95D33e5B565F2D965b6c1936857a4F4c4C",
    poolDawgsNFT: "0xDB45b92DdE171f1600e06D9734f7709fBbb0E706",
    chessDawgsNFT: "0x98FaC00f53b0d38F4853553bcF88Bb0e420Ef538",
  },
  1: {
    name: "Ethereum",
    poolDawgs: null, // not deployed on mainnet yet
    ddawgsToken: "0x19f78a898f3e3c2f40c6E0CD2EE5545F549d5E99",
    poolDawgsNFT: null,
    chessDawgsNFT: "0xf82E0cF5605101efE12689461c2bC9392BfDedEF",
  },
};

const active = NETWORKS[CHAIN_ID] ?? NETWORKS[11155111];

const envAddr = (key: string, fallback: Address | null): Address | null =>
  (process.env[key] as Address | undefined) || fallback;

export const NETWORK_NAME = active.name;
export const TANKDAWGS_ADDRESS = envAddr("NEXT_PUBLIC_TANKDAWGS_ADDRESS", active.poolDawgs);
export const DDAWGS_TOKEN_ADDRESS = envAddr(
  "NEXT_PUBLIC_DDAWGS_TOKEN_ADDRESS",
  active.ddawgsToken
);
export const TANKDAWGS_NFT_ADDRESS = envAddr(
  "NEXT_PUBLIC_TANKDAWGS_NFT_ADDRESS",
  active.poolDawgsNFT
);
export const CHESS_NFT_ADDRESS = envAddr("NEXT_PUBLIC_CHESS_NFT_ADDRESS", active.chessDawgsNFT);

/** True when the game proxy + token are known for the active network. */
export const CONTRACTS_CONFIGURED = Boolean(TANKDAWGS_ADDRESS && DDAWGS_TOKEN_ADDRESS);

/** Testnet (anything but Ethereum mainnet) — enables the public $DDawgs faucet. */
export const IS_TESTNET = CHAIN_ID !== 1;
