"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import {
  ERC20_ABI,
  FAUCET_TOKEN_ABI,
  TANK_DAWGS_ABI,
  type LobbyGame,
} from "@tankdawgs/shared";
import WalletGate from "@/components/WalletGate";
import {
  CHAIN_ID,
  CONTRACTS_CONFIGURED,
  DDAWGS_TOKEN_ADDRESS,
  IS_TESTNET,
  NETWORK_NAME,
  TANKDAWGS_ADDRESS,
} from "@/lib/env";
import { formatStake, shortAddress } from "@/lib/format";
import {
  newGameCode,
  newTeamGameCode,
  normalizeCode,
  maxPlayersFromId,
  teamSizeFromId,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TEAM_SIZES,
} from "@/lib/gamecode";
import { log } from "@/lib/log";
import { getSocket } from "@/lib/socket";

export default function LobbyPage() {
  return (
    <WalletGate>
      <Lobby />
    </WalletGate>
  );
}

const SEAT_OPTIONS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

function Lobby() {
  const router = useRouter();
  const search = useSearchParams();
  const { address } = useAccount();
  // Pin reads to the configured chain so they work even when the wallet is
  // momentarily on a different network.
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const connectedChain = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [games, setGames] = useState<LobbyGame[]>([]);
  // format: "ffa" + a seat count (2…8), or a team match (teamSize per side).
  const [format, setFormat] = useState<"ffa" | "team">("ffa");
  const [ffaSeats, setFfaSeats] = useState(2);
  const [teamSize, setTeamSize] = useState(2);
  const [stakeInput, setStakeInput] = useState("100");
  const [joinCode, setJoinCode] = useState(search.get("join") ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTeam = format === "team";
  const maxPlayers = isTeam ? teamSize * 2 : ffaSeats;
  const teamSizeArg = isTeam ? teamSize : 0;
  const mintCode = () => (isTeam ? newTeamGameCode(teamSize) : newGameCode(ffaSeats));
  const formatLabel = isTeam ? `${teamSize}v${teamSize}` : `${maxPlayers}-tank free-for-all`;

  // Live browse list over the socket.
  useEffect(() => {
    const socket = getSocket();
    const onState = (p: { games: LobbyGame[] }) => setGames(p.games);
    socket.on("lobby:state", onState);
    socket.emit("lobby:subscribe");
    return () => {
      socket.off("lobby:state", onState);
      socket.emit("lobby:unsubscribe");
    };
  }, []);

  async function createOnChain() {
    setError(null);
    if (!TANKDAWGS_ADDRESS || !DDAWGS_TOKEN_ADDRESS) {
      setError("Contracts aren't configured for this network.");
      return;
    }
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    if (!publicClient) {
      setError(`No RPC for ${NETWORK_NAME}. Check your network.`);
      return;
    }
    setBusy("create");
    try {
      const stake = parseUnits(stakeInput || "0", 18);
      if (stake <= 0n) throw new Error("Enter a stake greater than 0");

      // Make sure the wallet is on the configured chain before we transact —
      // otherwise the approve/create txs target the wrong network (or silently
      // never prompt).
      if (connectedChain !== CHAIN_ID) {
        await switchChainAsync({ chainId: CHAIN_ID });
      }

      // Pick a code free on-chain; the prefix encodes the format (FFA/team).
      let gameId = mintCode();
      for (let i = 0; i < 5; i++) {
        const g = (await publicClient.readContract({
          address: TANKDAWGS_ADDRESS,
          abi: TANK_DAWGS_ABI,
          functionName: "getGame",
          args: [gameId],
        })) as unknown as readonly [readonly string[], number, ...unknown[]];
        if (Number(g[1]) === 0) break; // maxPlayers 0 → free id
        gameId = mintCode();
      }

      const allowance = (await publicClient.readContract({
        address: DDAWGS_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, TANKDAWGS_ADDRESS],
      })) as bigint;
      if (allowance < stake) {
        const a = await writeContractAsync({
          address: DDAWGS_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TANKDAWGS_ADDRESS, stake],
          chainId: CHAIN_ID,
        });
        await publicClient.waitForTransactionReceipt({ hash: a });
      }
      log.info("lobby: createGame", gameId, maxPlayers, "teamSize", teamSizeArg, "stake", stakeInput);
      const tx = await writeContractAsync({
        address: TANKDAWGS_ADDRESS,
        abi: TANK_DAWGS_ABI,
        functionName: "createGame",
        args: [stake, maxPlayers, teamSizeArg, gameId],
        chainId: CHAIN_ID,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      router.push(`/game/${gameId}`);
    } catch (e) {
      log.error("lobby: create failed", e);
      setError(e instanceof Error ? e.message.split("\n")[0] : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  function createDev() {
    router.push(`/game/${mintCode()}`);
  }

  function join() {
    const code = normalizeCode(joinCode);
    if (code) router.push(`/game/${code}`);
  }

  async function faucet() {
    setError(null);
    if (!DDAWGS_TOKEN_ADDRESS || !publicClient || !address) return;
    setBusy("faucet");
    try {
      if (connectedChain !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID });
      const tx = await writeContractAsync({
        address: DDAWGS_TOKEN_ADDRESS,
        abi: FAUCET_TOKEN_ABI,
        functionName: "mint",
        chainId: CHAIN_ID,
        args: [address, parseUnits("10000", 18)],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Faucet failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_360px]">
      {/* ── Open battles ── */}
      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-3xl">💥</span>
          <h1 className="heading-display text-3xl">Open battles</h1>
        </div>
        {games.length === 0 ? (
          <div className="panel p-10 text-center text-cream/50">
            No open battles. Create one →
          </div>
        ) : (
          <ul className="space-y-3">
            {games.map((game) => {
              const mine = address && game.creator.toLowerCase() === address.toLowerCase();
              return (
                <li key={game.gameId} className="panel flex items-center gap-4 px-5 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-wood-grain text-lg">🪖</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-semibold text-amber-50">{game.gameId}</p>
                    <p className="text-xs text-amber-100/60">
                      {game.teamSize > 0 ? `${game.teamSize}v${game.teamSize}` : "Free-for-all"} ·{" "}
                      {game.playerCount}/{game.maxPlayers} tanks · {formatStake(game.stake)} ·{" "}
                      {game.creatorName?.trim() || shortAddress(game.creator)}
                      {mine ? " · your battle" : ""}
                    </p>
                  </div>
                  <button className="btn-outline" onClick={() => router.push(`/game/${game.gameId}`)}>
                    {mine ? "Open" : "Join"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Create / join ── */}
      <aside className="space-y-6">
        <div className="panel panel-gilt p-5">
          <h2 className="heading-display mb-3 text-xl">New battle</h2>

          <label className="mb-1 block text-xs uppercase tracking-widest text-amber-100/60">Format</label>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormat("ffa")}
              aria-pressed={!isTeam}
              className={`rounded-lg border py-2 text-sm font-semibold transition ${
                !isTeam
                  ? "border-gold bg-gold/15 text-gold-bright"
                  : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70 hover:border-gold/60"
              }`}
            >
              Free-for-all
            </button>
            <button
              type="button"
              onClick={() => setFormat("team")}
              aria-pressed={isTeam}
              className={`rounded-lg border py-2 text-sm font-semibold transition ${
                isTeam
                  ? "border-gold bg-gold/15 text-gold-bright"
                  : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70 hover:border-gold/60"
              }`}
            >
              Teams
            </button>
          </div>

          {isTeam ? (
            <>
              <label className="mb-1 block text-xs uppercase tracking-widest text-amber-100/60">Team size</label>
              <div className="mb-4 grid grid-cols-3 gap-2">
                {TEAM_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTeamSize(s)}
                    aria-pressed={teamSize === s}
                    className={`rounded-lg border py-2 text-sm font-semibold transition ${
                      teamSize === s
                        ? "border-gold bg-gold/15 text-gold-bright"
                        : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70 hover:border-gold/60"
                    }`}
                  >
                    {s}v{s}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="mb-1 block text-xs uppercase tracking-widest text-amber-100/60">Players</label>
              <div className="mb-4 grid grid-cols-4 gap-2">
                {SEAT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setFfaSeats(n)}
                    aria-pressed={ffaSeats === n}
                    className={`rounded-lg border py-2 text-sm font-semibold transition ${
                      ffaSeats === n
                        ? "border-gold bg-gold/15 text-gold-bright"
                        : "border-gold-dim/40 bg-mahogany-deep text-amber-100/70 hover:border-gold/60"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          {CONTRACTS_CONFIGURED ? (
            <>
              <label className="mb-1 block text-xs uppercase tracking-widest text-amber-100/60">
                Stake ($DDawgs / player)
              </label>
              <input
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value)}
                inputMode="decimal"
                className="mb-4 w-full rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 outline-none focus:border-gold"
              />
              <button className="btn-gold w-full" disabled={busy !== null} onClick={createOnChain}>
                {busy === "create" ? "Confirm in wallet…" : "Stake & create"}
              </button>
              <p className="mt-3 text-xs text-amber-100/50">
                Opens a {formatLabel} battle, escrows your stake, and gives you a code to share.
                {isTeam
                  ? " The winning team splits 80% of the pot equally"
                  : " Winner takes 80% of the pot"}{" "}
                (10% house, 10% burned).
              </p>
            </>
          ) : (
            <>
              <button className="btn-gold w-full" onClick={createDev}>
                Create dev battle
              </button>
              <p className="mt-3 text-xs text-amber-100/50">
                Contracts aren&rsquo;t configured for this network, so battles run in chain-less dev
                mode (no stakes). Opens a {formatLabel}; the battle starts when {maxPlayers} wallets join.
              </p>
            </>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>

        <div className="panel p-5">
          <h2 className="heading-display mb-3 text-xl">Join by code</h2>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="TD2-XXXXX"
              className="min-w-0 flex-1 rounded-lg border border-gold-dim/40 bg-mahogany-deep px-3 py-2 font-mono uppercase outline-none focus:border-gold"
            />
            <button className="btn-outline" onClick={join}>
              Go
            </button>
          </div>
          {joinCode && (
            <p className="mt-2 text-[11px] text-amber-100/40">
              {maxPlayersFromId(normalizeCode(joinCode))}-tank battle
            </p>
          )}
        </div>

        {CONTRACTS_CONFIGURED && IS_TESTNET && (
          <div className="panel p-5">
            <h2 className="heading-display mb-2 text-lg">Test tokens</h2>
            <button className="btn-outline w-full" disabled={busy !== null} onClick={faucet}>
              {busy === "faucet" ? "Minting…" : "Get 10,000 $DDawgs"}
            </button>
          </div>
        )}

        <div className="panel p-5 text-xs leading-relaxed text-amber-100/60">
          <h3 className="mb-2 font-semibold text-gold">Rules of engagement</h3>
          <ul className="list-inside list-disc space-y-1">
            <li>Take turns: set angle, power &amp; weapon, then fire.</li>
            <li>Mind the wind — it pushes your shell east or west.</li>
            <li>Last tank standing wins. Resign or time out = your tank is destroyed.</li>
            <li>Winner claims 80% of the pot. 10% house, 10% burned.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
