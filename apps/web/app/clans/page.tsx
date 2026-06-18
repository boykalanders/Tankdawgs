"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { TANK_DAWGS_CLANS_ABI, type Address } from "@tankdawgs/shared";
import WalletGate from "@/components/WalletGate";
import { CHAIN_ID, CLANS_CONFIGURED, NETWORK_NAME, TANKDAWGS_CLANS_ADDRESS } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import { useClan, type Clan } from "@/lib/useClan";

export default function ClansPage() {
  return (
    <WalletGate>
      <Clans />
    </WalletGate>
  );
}

interface ClanRow {
  clanId: number;
  name: string;
  tag: string;
  founder: Address;
}

const CREATED = parseAbiItem(
  "event ClanCreated(uint256 indexed clanId, address indexed founder, string name, string tag)"
);
const JOINED = parseAbiItem("event MemberJoined(uint256 indexed clanId, address indexed member)");
const LEFT = parseAbiItem("event MemberLeft(uint256 indexed clanId, address indexed member)");

function Clans() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const connectedChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { clan, refetch } = useClan(address as Address | undefined);

  const [allClans, setAllClans] = useState<ClanRow[]>([]);
  const [roster, setRoster] = useState<Address[]>([]);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Browse all clans (reconstructed from ClanCreated events).
  useEffect(() => {
    if (!publicClient || !TANKDAWGS_CLANS_ADDRESS) return;
    let cancelled = false;
    (async () => {
      try {
        const head = await publicClient.getBlockNumber();
        const fromBlock = head > 45000n ? head - 45000n : 0n; // public RPCs cap the range
        const logs = await publicClient.getLogs({
          address: TANKDAWGS_CLANS_ADDRESS,
          event: CREATED,
          fromBlock,
          toBlock: "latest",
        });
        if (cancelled) return;
        setAllClans(
          logs.map((l) => ({
            clanId: Number(l.args.clanId),
            name: String(l.args.name),
            tag: String(l.args.tag),
            founder: l.args.founder as Address,
          }))
        );
      } catch {
        /* event scan best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, refreshTick]);

  // My clan's current roster (MemberJoined − MemberLeft for that clanId).
  useEffect(() => {
    if (!publicClient || !TANKDAWGS_CLANS_ADDRESS || !clan) {
      setRoster([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const id = BigInt(clan.clanId);
        const head = await publicClient.getBlockNumber();
        const fromBlock = head > 45000n ? head - 45000n : 0n;
        const [joined, left] = await Promise.all([
          publicClient.getLogs({ address: TANKDAWGS_CLANS_ADDRESS, event: JOINED, args: { clanId: id }, fromBlock, toBlock: "latest" }),
          publicClient.getLogs({ address: TANKDAWGS_CLANS_ADDRESS, event: LEFT, args: { clanId: id }, fromBlock, toBlock: "latest" }),
        ]);
        if (cancelled) return;
        const members = new Set<string>();
        for (const l of joined) members.add(String(l.args.member).toLowerCase());
        for (const l of left) members.delete(String(l.args.member).toLowerCase());
        setRoster([...members] as Address[]);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, clan, refreshTick]);

  const tx = useCallback(
    async (label: string, fn: () => Promise<`0x${string}`>) => {
      setError(null);
      if (connectedChain !== CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: CHAIN_ID });
        } catch {
          setError(`Switch to ${NETWORK_NAME} to continue.`);
          return;
        }
      }
      setBusy(label);
      try {
        const hash = await fn();
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
        refetch();
        setRefreshTick((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message.split("\n")[0] : "Transaction failed");
      } finally {
        setBusy(null);
      }
    },
    [connectedChain, switchChainAsync, publicClient, refetch]
  );

  const create = () =>
    tx("create", () =>
      writeContractAsync({
        address: TANKDAWGS_CLANS_ADDRESS!,
        abi: TANK_DAWGS_CLANS_ABI,
        functionName: "createClan",
        args: [name.trim(), tag.trim().toUpperCase()],
        chainId: CHAIN_ID,
      })
    );
  const join = (clanId: number) =>
    tx("join", () =>
      writeContractAsync({
        address: TANKDAWGS_CLANS_ADDRESS!,
        abi: TANK_DAWGS_CLANS_ABI,
        functionName: "joinClan",
        args: [BigInt(clanId)],
        chainId: CHAIN_ID,
      })
    );
  const leave = () =>
    tx("leave", () =>
      writeContractAsync({
        address: TANKDAWGS_CLANS_ADDRESS!,
        abi: TANK_DAWGS_CLANS_ABI,
        functionName: "leaveClan",
        args: [],
        chainId: CHAIN_ID,
      })
    );

  if (!CLANS_CONFIGURED) {
    return (
      <div className="panel mx-auto mt-10 max-w-md p-8 text-center text-cream/60">
        The clan registry isn&rsquo;t configured on {NETWORK_NAME} yet.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl">🛡️</span>
        <h1 className="heading-display text-3xl">Clans</h1>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      {clan ? (
        <MyClan clan={clan} roster={roster} me={address as Address} onLeave={leave} leaving={busy === "leave"} />
      ) : (
        <section className="panel panel-gilt p-6">
          <h2 className="heading-display mb-3 text-xl">Found a clan</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <input
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              placeholder="Clan name"
              className="rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
            />
            <input
              value={tag}
              maxLength={6}
              onChange={(e) => setTag(e.target.value.toUpperCase())}
              placeholder="TAG"
              className="rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 font-mono uppercase outline-none focus:border-gold"
            />
          </div>
          <button
            className="btn-gold mt-3 w-full"
            disabled={busy !== null || name.trim().length < 1 || tag.trim().length < 2}
            onClick={create}
          >
            {busy === "create" ? "Confirm in wallet…" : "Create clan"}
          </button>
          <p className="mt-2 text-[11px] text-cream/45">
            One clan per wallet. Tag is 2–6 characters and must be unique.
          </p>
        </section>
      )}

      <section>
        <h2 className="heading-display mb-3 text-xl">All clans</h2>
        {allClans.length === 0 ? (
          <div className="panel p-8 text-center text-cream/50">No clans yet — found the first.</div>
        ) : (
          <ul className="space-y-2">
            {allClans.map((c) => {
              const mine = clan?.clanId === c.clanId;
              return (
                <li key={c.clanId} className="panel flex items-center gap-3 px-4 py-3">
                  <span className="rounded-md border border-gold/50 bg-black/40 px-2 py-1 font-mono text-xs font-bold text-gold-bright">
                    [{c.tag}]
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-amber-50">{c.name}</p>
                    <p className="text-xs text-cream/55">founded by {shortAddress(c.founder)}</p>
                  </div>
                  {mine ? (
                    <span className="text-xs text-gold-bright">your clan</span>
                  ) : !clan ? (
                    <button className="btn-outline" disabled={busy !== null} onClick={() => join(c.clanId)}>
                      {busy === "join" ? "…" : "Join"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function MyClan({
  clan,
  roster,
  me,
  onLeave,
  leaving,
}: {
  clan: Clan;
  roster: Address[];
  me: Address;
  onLeave: () => void;
  leaving: boolean;
}) {
  return (
    <section className="panel panel-gilt p-6">
      <div className="flex items-center gap-3">
        <span className="rounded-lg border border-gold/60 bg-black/40 px-3 py-1.5 font-mono text-lg font-bold text-gold-bright">
          [{clan.tag}]
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="heading-display text-2xl">{clan.name}</h2>
          <p className="text-xs text-cream/55">
            {clan.memberCount} member{clan.memberCount === 1 ? "" : "s"} · founded by {shortAddress(clan.founder)}
          </p>
        </div>
        <button className="btn-outline border-red-900/60 text-red-300 hover:border-red-500" disabled={leaving} onClick={onLeave}>
          {leaving ? "Leaving…" : "Leave"}
        </button>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-widest text-cream/50">Roster</p>
        <div className="flex flex-wrap gap-2">
          {(roster.length ? roster : [me]).map((m) => (
            <span
              key={m}
              className={`rounded-full border px-3 py-1 font-mono text-xs ${
                m.toLowerCase() === me.toLowerCase()
                  ? "border-gold/70 bg-gold/10 text-gold-bright"
                  : "border-gold-dim/40 bg-mahogany-deep text-cream/75"
              }`}
            >
              {shortAddress(m)}
              {m.toLowerCase() === clan.founder.toLowerCase() ? " 👑" : ""}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
