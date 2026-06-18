"use client";

import { useReadContract } from "wagmi";
import { TANK_DAWGS_CLANS_ABI, type Address } from "@tankdawgs/shared";
import { CHAIN_ID, CLANS_CONFIGURED, TANKDAWGS_CLANS_ADDRESS } from "./env";

export interface Clan {
  clanId: number;
  founder: Address;
  name: string;
  tag: string;
  memberCount: number;
}

/** The clan a wallet belongs to (null if none / registry not configured). */
export function useClan(address?: Address): { clan: Clan | null; loading: boolean; refetch: () => void } {
  const enabled = Boolean(CLANS_CONFIGURED && address);
  const { data: clanIdRaw, refetch: refetchId, isLoading: l1 } = useReadContract({
    address: TANKDAWGS_CLANS_ADDRESS ?? undefined,
    abi: TANK_DAWGS_CLANS_ABI,
    functionName: "clanOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled },
  });
  const clanId = clanIdRaw ? Number(clanIdRaw) : 0;

  const { data: clan, refetch: refetchClan, isLoading: l2 } = useReadContract({
    address: TANKDAWGS_CLANS_ADDRESS ?? undefined,
    abi: TANK_DAWGS_CLANS_ABI,
    functionName: "getClan",
    args: [BigInt(clanId)],
    chainId: CHAIN_ID,
    query: { enabled: enabled && clanId > 0 },
  });

  const refetch = () => {
    void refetchId();
    void refetchClan();
  };

  if (!clanId || !clan) return { clan: null, loading: l1 || l2, refetch };
  const [founder, name, tag, , memberCount] = clan as readonly [Address, string, string, bigint, number];
  return { clan: { clanId, founder, name, tag, memberCount: Number(memberCount) }, loading: false, refetch };
}
