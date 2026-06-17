// Short, human-shareable game codes — these ARE the on-chain gameId string.
// ChessDawgs-style: create → get a code → opponents join with it.
//
// The code embeds the seat count: "TD<N>-XXXXX" (N = 2…8). The web mints the
// code, the contract stores it verbatim, and the server/clients read N back to
// build the right N-tank battlefield (and seed the terrain from the gameId).

// Ambiguous characters (I, L, O, 0, 1) are excluded so codes read aloud / type
// cleanly.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

function clampPlayers(n: number): number {
  if (!Number.isFinite(n)) return MIN_PLAYERS;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(n)));
}

// Web Crypto is a global in both the browser and Node 18+, but the shared
// package compiles with lib: ["ES2022"] (no DOM), so reach it through a
// structurally-typed globalThis instead of the ambient `crypto` name.
function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const webcrypto = (globalThis as {
    crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T };
  }).crypto;
  if (webcrypto?.getRandomValues) return webcrypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** Mint a fresh code for an N-player battle, e.g. newGameCode(4) → "TD4-9PQ4K". */
export function newGameCode(maxPlayers = MIN_PLAYERS): string {
  let s = "";
  for (const b of randomBytes(5)) s += ALPHABET[b % ALPHABET.length];
  return `TD${clampPlayers(maxPlayers)}-${s}`;
}

/** Seat count encoded in a gameId (defaults to 2 for legacy/odd codes). */
export function maxPlayersFromId(gameId: string): number {
  const m = gameId.trim().toUpperCase().match(/^TD(\d)-/);
  return m ? clampPlayers(Number(m[1])) : MIN_PLAYERS;
}

/** Accept a raw code, a prefixed code, or a pasted invite link → canonical code. */
export function normalizeCode(input: string): string {
  let t = input.trim();
  const fromLink = t.match(/join=([^&\s]+)/i);
  if (fromLink) t = decodeURIComponent(fromLink[1]);
  t = t.toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  // Already a TD<N>- code → keep it.
  if (/^TD\d-/.test(t)) return t;
  // Bare body or stray prefix → assume a 2-player code.
  const body = t.includes("-") ? t.split("-").slice(1).join("-") : t;
  return `TD${MIN_PLAYERS}-${body}`;
}
