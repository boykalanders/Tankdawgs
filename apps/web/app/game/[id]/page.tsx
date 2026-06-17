"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useSignMessage, useWriteContract } from "wagmi";
import { type GameState, type ShotInput } from "@tankdawgs/engine";
import {
  ERC20_ABI,
  loginMessage,
  TANK_DAWGS_ABI,
  type Address,
  type ChatMessage,
  type GameOverReason,
  type RoomSnapshot,
  type ServerError,
  type ShotBroadcast,
} from "@tankdawgs/shared";
import GameShell, { type ShellPlayer } from "@/components/GameShell";
import type { ShotAnimation } from "@/components/TankCanvas";
import WalletGate from "@/components/WalletGate";
import WinnerPopup from "@/components/WinnerPopup";
import { CHAIN_ID, CONTRACTS_CONFIGURED, DDAWGS_TOKEN_ADDRESS, TANKDAWGS_ADDRESS } from "@/lib/env";
import { formatStake, shortAddress } from "@/lib/format";
import { inviteLink, maxPlayersFromId } from "@/lib/gamecode";
import { log } from "@/lib/log";
import { getSocket } from "@/lib/socket";

export default function GamePage() {
  return (
    <WalletGate>
      <GameRoom />
    </WalletGate>
  );
}

type Phase = "loading" | "notfound" | "waiting" | "invite" | "full" | "over" | "play";

/** Decoded getGame tuple: [players[], maxPlayers, stake, isCompleted, winner, rewardClaimed]. */
type ChainGame = readonly [readonly string[], number, bigint, boolean, string, boolean];

const REASON_WORD: Record<GameOverReason, string> = {
  ko: "last tank standing",
  resign: "a resignation",
  timeout: "the turn clock",
};

function GameRoom() {
  const params = useParams<{ id: string }>();
  const gameId = params.id;
  const maxPlayers = maxPlayersFromId(gameId);
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [renderState, setRenderState] = useState<GameState | null>(null);
  const [anim, setAnim] = useState<ShotAnimation | null>(null);
  const pendingEnd = useRef<GameState | null>(null);
  const seededChat = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const { data: myBalance } = useReadContract({
    address: DDAWGS_TOKEN_ADDRESS ?? undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(CONTRACTS_CONFIGURED && address) },
  });

  const { data: chainGame, refetch: refetchGame } = useReadContract({
    address: TANKDAWGS_ADDRESS ?? undefined,
    abi: TANK_DAWGS_ABI,
    functionName: "getGame",
    args: [gameId],
    query: { enabled: Boolean(CONTRACTS_CONFIGURED && gameId), refetchInterval: 4000 },
  });

  const me = address?.toLowerCase();
  let phase: Phase = "play";
  let onchainStake: bigint | null = null;
  let onchainWinner: string | null = null;

  if (CONTRACTS_CONFIGURED) {
    if (!chainGame) {
      phase = "loading";
    } else {
      const [players, max, stake, completed, winner] = chainGame as ChainGame;
      onchainStake = stake;
      onchainWinner = winner;
      const roster = players.map((p) => p.toLowerCase());
      const full = roster.length >= max;
      const amIn = !!me && roster.includes(me);
      if (max === 0) phase = "notfound";
      else if (completed) phase = "over";
      else if (amIn) phase = full ? "play" : "waiting";
      else phase = full ? "full" : "invite";
    }
  }
  const effectivePhase: Phase = snapshot ? "play" : phase;

  const cg = CONTRACTS_CONFIGURED && chainGame ? (chainGame as ChainGame) : null;
  const rewardClaimed = claimed || (cg ? cg[5] : false);

  const mySeat: number | null = (() => {
    if (!snapshot || !address) return null;
    const m = snapshot.players.find((p) => p.address.toLowerCase() === address.toLowerCase());
    return m ? m.seat : null;
  })();

  // Connect to the socket room once the battle is playable for us.
  useEffect(() => {
    if (!address || joined || effectivePhase !== "play") return;
    const socket = getSocket();
    let cancelled = false;
    (async () => {
      try {
        const ts = Date.now();
        const signature = await signMessageAsync({ message: loginMessage(address as Address, ts) });
        if (cancelled) return;
        socket.emit("room:join", { gameId, auth: { address: address as Address, ts, signature } });
        setJoined(true);
      } catch {
        setServerError("Signature rejected — sign in to take your seat.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, gameId, joined, effectivePhase, signMessageAsync]);

  // Socket subscriptions.
  useEffect(() => {
    const socket = getSocket();
    const onRoomState = (snap: RoomSnapshot) => {
      if (snap.gameId !== gameId) return;
      setSnapshot(snap);
      // Adopt the authoritative state unless we're mid-animation (the shot
      // animation owns the board until it finishes, then adopts endState).
      if (!pendingEnd.current) setRenderState(snap.state);
      if (!seededChat.current) {
        seededChat.current = true;
        if (snap.messages?.length) setMessages(snap.messages);
      }
    };
    const onShot = (b: ShotBroadcast) => {
      if (b.gameId !== gameId) return;
      pendingEnd.current = b.endState;
      setSnapshot((s) => (s ? { ...s, clockExpiresAt: b.clockExpiresAt } : s));
      setAnim({ trajectories: b.trajectories, impacts: b.impacts });
    };
    const onOver = (p: {
      gameId: string;
      winner: Address;
      reason: GameOverReason;
      txHash?: string;
      voucher?: string;
    }) => {
      if (p.gameId !== gameId) return;
      setSnapshot((s) =>
        s ? { ...s, over: { winner: p.winner, reason: p.reason, txHash: p.txHash, voucher: p.voucher } } : s
      );
    };
    const onChat = (m: ChatMessage) => {
      if (m.gameId === gameId) setMessages((prev) => [...prev, m]);
    };
    const onError = (e: ServerError) => setServerError(e.message);

    socket.on("room:state", onRoomState);
    socket.on("game:shot", onShot);
    socket.on("game:over", onOver);
    socket.on("chat:message", onChat);
    socket.on("server:error", onError);
    return () => {
      socket.off("room:state", onRoomState);
      socket.off("game:shot", onShot);
      socket.off("game:over", onOver);
      socket.off("chat:message", onChat);
      socket.off("server:error", onError);
      socket.emit("room:leave", { gameId });
    };
  }, [gameId]);

  const onAnimationEnd = useCallback(() => {
    if (pendingEnd.current) setRenderState(pendingEnd.current);
    pendingEnd.current = null;
    setAnim(null);
  }, []);

  const fire = useCallback(
    (shot: ShotInput) => {
      setServerError(null);
      getSocket().emit("game:fire", { gameId, shot });
    },
    [gameId]
  );

  async function joinThisGame() {
    if (!TANKDAWGS_ADDRESS || !DDAWGS_TOKEN_ADDRESS || !publicClient || !address || onchainStake === null) return;
    setActionError(null);
    setWorking("join");
    try {
      const allowance = (await publicClient.readContract({
        address: DDAWGS_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, TANKDAWGS_ADDRESS],
      })) as bigint;
      if (allowance < onchainStake) {
        const a = await writeContractAsync({
          address: DDAWGS_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [TANKDAWGS_ADDRESS, onchainStake],
        });
        await publicClient.waitForTransactionReceipt({ hash: a });
      }
      const tx = await writeContractAsync({
        address: TANKDAWGS_ADDRESS,
        abi: TANK_DAWGS_ABI,
        functionName: "joinGame",
        args: [gameId],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await refetchGame();
    } catch (e) {
      setActionError(e instanceof Error ? e.message.split("\n")[0] : "Join failed");
    } finally {
      setWorking(null);
    }
  }

  async function cancelGame() {
    if (!TANKDAWGS_ADDRESS || !publicClient) return;
    setActionError(null);
    setWorking("cancel");
    try {
      const tx = await writeContractAsync({
        address: TANKDAWGS_ADDRESS,
        abi: TANK_DAWGS_ABI,
        functionName: "cancelGame",
        args: [gameId],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      router.push("/lobby");
    } catch (e) {
      setActionError(e instanceof Error ? e.message.split("\n")[0] : "Cancel failed");
    } finally {
      setWorking(null);
    }
  }

  async function claim() {
    if (!TANKDAWGS_ADDRESS) return;
    const voucher = snapshot?.over?.voucher;
    if (!voucher) {
      setActionError("Reward voucher isn't ready yet — you can also claim from your Profile.");
      return;
    }
    setActionError(null);
    setWorking("claim");
    try {
      const tx = await writeContractAsync({
        address: TANKDAWGS_ADDRESS,
        abi: TANK_DAWGS_ABI,
        functionName: "claimRewardSigned",
        args: [gameId, voucher as `0x${string}`],
        chainId: CHAIN_ID,
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash: tx });
      setClaimed(true);
      await refetchGame();
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : "Claim failed";
      setActionError(/already claimed/i.test(msg) ? "Reward already claimed." : msg);
    } finally {
      setWorking(null);
    }
  }

  function copy(kind: "code" | "link", text: string) {
    void navigator.clipboard?.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  // ── pre-game screens ──
  if (effectivePhase !== "play") {
    const Card = ({ children }: { children: React.ReactNode }) => (
      <div className="panel mx-auto mt-10 max-w-md space-y-4 p-8 text-center">{children}</div>
    );
    const Back = () => (
      <button className="btn-outline" onClick={() => router.push("/lobby")}>
        Back to lobby
      </button>
    );
    if (effectivePhase === "loading") return <Card>Loading battle {gameId}…</Card>;
    if (effectivePhase === "notfound")
      return (
        <Card>
          <div className="text-4xl">🔍</div>
          <h2 className="heading-display text-2xl">No battle with that code</h2>
          <p className="text-sm text-amber-100/60">
            <span className="font-mono text-gold-bright">{gameId}</span> doesn&rsquo;t exist yet.
          </p>
          <Back />
        </Card>
      );
    if (effectivePhase === "full")
      return (
        <Card>
          <div className="text-4xl">🚫</div>
          <h2 className="heading-display text-2xl">That battle is full</h2>
          <p className="text-sm text-amber-100/60">All {maxPlayers} seats are taken.</p>
          <Back />
        </Card>
      );
    if (effectivePhase === "waiting")
      return (
        <Card>
          <h2 className="heading-display text-2xl">Waiting for players…</h2>
          <p className="text-xs uppercase tracking-widest text-gold-bright/80">
            {maxPlayers}-tank battle · share to fill the seats
          </p>
          <div className="rounded-lg border border-gold/50 bg-mahogany-deep px-4 py-3 font-mono text-2xl font-bold tracking-widest text-gold-bright">
            {gameId}
          </div>
          <div className="flex gap-2">
            <button className="btn-outline flex-1" onClick={() => copy("code", gameId)}>
              {copied === "code" ? "Copied ✓" : "Copy code"}
            </button>
            <button className="btn-outline flex-1" onClick={() => copy("link", inviteLink(gameId))}>
              {copied === "link" ? "Copied ✓" : "Copy link"}
            </button>
          </div>
          {actionError && <p className="text-sm text-red-300">{actionError}</p>}
          <button
            className="btn-outline w-full border-red-900/60 text-red-300 hover:border-red-500"
            disabled={working !== null}
            onClick={cancelGame}
          >
            {working === "cancel" ? "Cancelling…" : "Cancel & refund all"}
          </button>
        </Card>
      );
    if (effectivePhase === "invite")
      return (
        <Card>
          <div className="text-4xl">💥</div>
          <h2 className="heading-display text-2xl">You&rsquo;ve been called to battle</h2>
          <p className="text-sm text-amber-100/60">
            {maxPlayers}-tank battle <span className="font-mono text-gold-bright">{gameId}</span>
            {onchainStake !== null && (
              <>
                {" "}
                — stake <span className="text-gold-bright">{formatStake(onchainStake)}</span>
              </>
            )}
          </p>
          <button className="btn-gold w-full" disabled={working !== null} onClick={joinThisGame}>
            {working === "join" ? "Joining…" : "Stake & join"}
          </button>
          {actionError && <p className="text-sm text-red-300">{actionError}</p>}
          <Back />
        </Card>
      );
    if (effectivePhase === "over") {
      const iWon = !!me && onchainWinner && onchainWinner.toLowerCase() === me;
      return (
        <Card>
          <div className="text-4xl">🏆</div>
          <h2 className="heading-display text-2xl">{iWon ? "You won this one" : "Battle over"}</h2>
          {iWon && !rewardClaimed && (
            <button className="btn-gold w-full" onClick={() => router.push("/profile")}>
              Claim 80% of the pot
            </button>
          )}
          {rewardClaimed && <p className="text-gold-bright">Reward claimed ✓</p>}
          <Back />
        </Card>
      );
    }
  }

  // ── connecting ──
  if (!snapshot || !renderState) {
    return (
      <div className="panel mx-auto mt-10 max-w-md space-y-3 p-10 text-center text-amber-100/60">
        {serverError ? <p className="text-red-300">{serverError}</p> : <p>Deploying to the field at {gameId}…</p>}
        <button className="btn-outline" onClick={() => router.push("/lobby")}>
          Back to lobby
        </button>
      </div>
    );
  }

  const over = snapshot.over;
  const myTurn =
    mySeat !== null && !renderState.gameOver && renderState.turn === mySeat && !over && !anim;
  const iWon = over && address && over.winner.toLowerCase() === address.toLowerCase();

  const shellPlayers: ShellPlayer[] = snapshot.players.map((p) => {
    const isMe = address && p.address.toLowerCase() === address.toLowerCase();
    const baseName = p.username?.trim() || shortAddress(p.address);
    return {
      seat: p.seat,
      name: isMe ? `${baseName} (you)` : baseName,
      detail:
        isMe && myBalance !== undefined
          ? `${Number(formatUnits(myBalance, 18)).toLocaleString()} $DDAWGS`
          : undefined,
      connected: p.connected,
    };
  });

  const statusText = over
    ? over.winner === "0x0000000000000000000000000000000000000000"
      ? "Mutual destruction — draw"
      : `${shortAddress(over.winner)} wins by ${REASON_WORD[over.reason]}`
    : anim
      ? "Shell away…"
      : myTurn
        ? "Your shot"
        : mySeat === null
          ? "Spectating"
          : "Hold position…";

  const stake = snapshot.stake ? BigInt(snapshot.stake) : null;
  const potWin = stake ? formatStake((stake * BigInt(snapshot.players.length) * 8000n) / 10000n) : null;

  return (
    <GameShell
      state={renderState}
      players={shellPlayers}
      mySeat={mySeat}
      interactive={Boolean(myTurn)}
      potLabel={stake ? formatStake(stake * BigInt(snapshot.players.length)) : null}
      balanceLabel={myBalance !== undefined ? Number(formatUnits(myBalance, 18)).toLocaleString() : null}
      clockExpiresAt={over ? null : snapshot.clockExpiresAt}
      statusText={statusText}
      banner={serverError}
      animation={anim}
      onFire={fire}
      onAnimationEnd={onAnimationEnd}
      menuItems={[
        ...(mySeat !== null && !over
          ? [
              {
                label: "Resign (forfeit)",
                onClick: () => getSocket().emit("game:resign", { gameId }),
                danger: true,
              },
            ]
          : []),
        { label: "Exit to lobby", onClick: () => router.push("/lobby") },
      ]}
      chat={{
        messages,
        myAddress: address ?? null,
        onSend: (text) => getSocket().emit("chat:send", { gameId, text }),
      }}
      overlay={
        over && !anim ? (
          iWon ? (
            <WinnerPopup
              winnerName="You"
              message={`Won by ${REASON_WORD[over.reason]}`}
              amountLabel={potWin ? `+${potWin}` : null}
              actions={
                <>
                  {CONTRACTS_CONFIGURED &&
                    !rewardClaimed &&
                    (over.voucher ? (
                      <button className="btn-gold" disabled={working === "claim"} onClick={claim}>
                        {working === "claim" ? "Claiming…" : "Claim 80% of the pot"}
                      </button>
                    ) : (
                      <span className="self-center text-[11px] text-amber-100/60">Preparing voucher…</span>
                    ))}
                  {rewardClaimed && <span className="self-center text-gold-bright">Reward claimed ✓</span>}
                  {actionError && <span className="self-center text-sm text-red-300">{actionError}</span>}
                  <button className="btn-outline" onClick={() => router.push("/lobby")}>
                    Back to lobby
                  </button>
                </>
              }
            />
          ) : (
            <WinnerPopup
              defeated
              winnerName={over.winner === "0x0000000000000000000000000000000000000000" ? "Nobody" : shortAddress(over.winner)}
              message={`Won by ${REASON_WORD[over.reason]}`}
              amountLabel={stake ? `−${formatStake(stake)}` : null}
              actions={
                <button className="btn-outline" onClick={() => router.push("/lobby")}>
                  Back to lobby
                </button>
              }
            />
          )
        ) : null
      }
    />
  );
}
