import "dotenv/config";
import { TURN_CLOCK_MS } from "@tankdawgs/shared";

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  rpcUrl: string | null;
  contractAddress: string | null;
  ownerPrivateKey: string | null;
  /** Dedicated low-privilege settlement key (preferred over the owner key).
   *  Can only call finishGame on-chain — see TankDawgs.onlyRelayer. */
  operatorPrivateKey: string | null;
  turnClockMs: number;
  /** True when RPC + contract are configured; otherwise chain-less dev mode. */
  chainEnabled: boolean;
  /** Directory for best-effort JSON persistence (usernames). */
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rpcUrl = env.RPC_URL || null;
  const contractAddress = env.CONTRACT_ADDRESS || null;
  return {
    port: Number(env.PORT) || 4000,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    rpcUrl,
    contractAddress,
    ownerPrivateKey: env.OWNER_PRIVATE_KEY || null,
    operatorPrivateKey: env.OPERATOR_PRIVATE_KEY || null,
    turnClockMs: Number(env.TURN_CLOCK_MS) || TURN_CLOCK_MS,
    chainEnabled: Boolean(rpcUrl && contractAddress),
    dataDir: env.DATA_DIR || process.cwd(),
  };
}
