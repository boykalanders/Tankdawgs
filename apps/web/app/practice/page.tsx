"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createInitialState,
  simulateShot,
  validateShot,
  type GameState,
  type ShotInput,
} from "@tankdawgs/engine";
import GameShell, { type ShellPlayer } from "@/components/GameShell";
import type { ShotAnimation } from "@/components/TankCanvas";
import WinnerPopup from "@/components/WinnerPopup";

const NAMES = ["Deputy Dawg", "Outlaw Dawg", "Ranger Dawg", "Bandit Dawg"];
const AVATARS = ["/assets/avatar-deputy.png", "/assets/avatar-outlaw.png", undefined, undefined];

/** Local hot-seat artillery — runs the deterministic engine with no wallet,
 *  server or chain. Players take turns on one screen. */
export default function PracticePage() {
  const router = useRouter();
  const [players, setPlayers] = useState(2);
  const [seedTick, setSeedTick] = useState(1);
  const [state, setState] = useState<GameState>(() =>
    createInitialState({ players: 2, seed: 0x7a11c })
  );
  const [anim, setAnim] = useState<ShotAnimation | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const pendingEnd = useRef<GameState | null>(null);

  const reset = useCallback(
    (n = players) => {
      const seed = (0x7a11c + seedTick * 2654435761) >>> 0;
      setSeedTick((t) => t + 1);
      setState(createInitialState({ players: n, seed }));
      setAnim(null);
      setBanner(null);
      pendingEnd.current = null;
    },
    [players, seedTick]
  );

  const setCount = useCallback(
    (n: number) => {
      setPlayers(n);
      reset(n);
    },
    [reset]
  );

  const fire = useCallback(
    (shot: ShotInput) => {
      if (anim || state.gameOver) return;
      const valid = validateShot(state, shot);
      if (!valid.ok) {
        setBanner(valid.reason);
        return;
      }
      setBanner(null);
      const res = simulateShot(state, shot);
      pendingEnd.current = res.endState;
      setAnim({ shells: res.shells });
    },
    [anim, state]
  );

  const onAnimationEnd = useCallback(() => {
    if (pendingEnd.current) setState(pendingEnd.current);
    pendingEnd.current = null;
    setAnim(null);
  }, []);

  const shellPlayers: ShellPlayer[] = state.tanks.map((t) => ({
    seat: t.seat,
    name: NAMES[t.seat] ?? `Dawg ${t.seat + 1}`,
    avatarSrc: AVATARS[t.seat],
    connected: true,
  }));

  const statusText = state.gameOver
    ? state.winner !== null
      ? `🏆 ${NAMES[state.winner] ?? `Dawg ${state.winner + 1}`} wins!`
      : "Mutual destruction — draw"
    : anim
      ? "Shell away…"
      : `${NAMES[state.turn] ?? `Dawg ${state.turn + 1}`} to fire`;

  return (
    <GameShell
      state={state}
      players={shellPlayers}
      mySeat={anim || state.gameOver ? null : state.turn}
      interactive={!anim && !state.gameOver}
      potLabel="250 $DDAWGS"
      balanceLabel="10,000"
      clockExpiresAt={null}
      statusText={statusText}
      banner={banner}
      animation={anim}
      onFire={fire}
      onAnimationEnd={onAnimationEnd}
      menuItems={[
        { label: "New battle", onClick: () => reset() },
        ...[2, 3, 4]
          .filter((n) => n !== players)
          .map((n) => ({ label: `${n} players`, onClick: () => setCount(n) })),
        { label: "Exit to lobby", onClick: () => router.push("/lobby") },
      ]}
      overlay={
        state.gameOver && state.winner !== null ? (
          <WinnerPopup
            winnerName={NAMES[state.winner] ?? `Dawg ${state.winner + 1}`}
            avatarSrc={AVATARS[state.winner]}
            message="last tank standing"
            amountLabel="+200 $DDAWGS"
            actions={
              <>
                <button className="btn-gold" onClick={() => reset()}>
                  Rematch
                </button>
                <button className="btn-outline" onClick={() => router.push("/lobby")}>
                  Lobby
                </button>
              </>
            }
          />
        ) : null
      }
    />
  );
}
