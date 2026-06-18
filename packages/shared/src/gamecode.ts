// Short, human-shareable game codes — these ARE the on-chain gameId string.
//
// The code embeds the format:
//   • Free-for-all:  "TD<N>-XXXXX"      (N = 2…8 players)
//   • Team match:    "TD<S>V<S>-XXXXX"  (S = 2/3/4 → 2v2 / 3v3 / 4v4)
// The web mints the code, the contract stores it verbatim, and the
// server/clients read the format back to build the right battlefield (and seed
// the terrain from the gameId).

// Ambiguous characters (I, L, O, 0, 1) are excluded so codes read aloud / type
// cleanly.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Allowed team sizes (2v2 / 3v3 / 4v4). */
export const TEAM_SIZES = [2, 3, 4] as const;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const webcrypto = (globalThis as {
    crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T };
  }).crypto;
  if (webcrypto?.getRandomValues) return webcrypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function body(): string {
  let s = "";
  for (const b of randomBytes(5)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** Mint a free-for-all code for `maxPlayers` players, e.g. "TD4-9PQ4K". */
export function newGameCode(maxPlayers = MIN_PLAYERS): string {
  return `TD${clamp(maxPlayers, MIN_PLAYERS, MAX_PLAYERS)}-${body()}`;
}

/** Mint a team-match code for `teamSize` per side, e.g. "TD2V2-9PQ4K". */
export function newTeamGameCode(teamSize: number): string {
  const s = clamp(teamSize, 2, 4);
  return `TD${s}V${s}-${body()}`;
}

/** Players per team encoded in a gameId (0 = free-for-all). */
export function teamSizeFromId(gameId: string): number {
  const m = gameId.trim().toUpperCase().match(/^TD(\d)V(\d)-/);
  return m ? clamp(Number(m[1]), 2, 4) : 0;
}

/** Total seats encoded in a gameId (team code → 2×teamSize; FFA → N). */
export function maxPlayersFromId(gameId: string): number {
  const team = teamSizeFromId(gameId);
  if (team) return team * 2;
  const m = gameId.trim().toUpperCase().match(/^TD(\d)-/);
  return m ? clamp(Number(m[1]), MIN_PLAYERS, MAX_PLAYERS) : MIN_PLAYERS;
}

/** Accept a raw code, a prefixed code, or a pasted invite link → canonical code. */
export function normalizeCode(input: string): string {
  let t = input.trim();
  const fromLink = t.match(/join=([^&\s]+)/i);
  if (fromLink) t = decodeURIComponent(fromLink[1]);
  t = t.toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  if (/^TD\dV\d-/.test(t) || /^TD\d-/.test(t)) return t; // already canonical
  const rest = t.includes("-") ? t.split("-").slice(1).join("-") : t;
  return `TD${MIN_PLAYERS}-${rest}`;
}
