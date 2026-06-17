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
    // TankDawgs is not deployed yet — fill these in after `deploy:sepolia`
    // (or set the NEXT_PUBLIC_* env vars). Until then the app runs chain-less.
    poolDawgs: null,
    ddawgsToken: null,
    poolDawgsNFT: null,
    chessDawgsNFT: null,
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
