"use client";

// Lightweight WebAudio sound — synthesised artillery fire + explosions, so
// there are no audio assets to ship. The AudioContext is created lazily on the
// first sound (which always follows a user gesture, satisfying autoplay rules).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A short burst of filtered noise — the body of a boom/whoosh. */
function noiseBurst(ac: AudioContext, at: number, dur: number, gain: number, cutoff: number): void {
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(lp).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + dur);
}

/** A low sine "thump" that drops in pitch — the punch of a cannon/explosion. */
function thump(ac: AudioContext, at: number, from: number, to: number, dur: number, gain: number): void {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur);
}

/** Cannon firing — a sharp crack + low thump. */
export function playFire(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  noiseBurst(ac, t, 0.18, 0.5, 1800);
  thump(ac, t, 220, 70, 0.22, 0.55);
}

/** Explosion — bigger booms for bigger blasts (radius ~18…64). */
export function playBoom(radius = 34): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const big = Math.min(1.4, radius / 36);
  noiseBurst(ac, t, 0.32 * big, 0.6, 900);
  thump(ac, t, 160 * (1.2 - big * 0.3), 40, 0.4 * big, 0.6);
}
