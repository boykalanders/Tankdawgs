import type { Address, LobbyGame, LobbyGameStatus } from "@tankdawgs/shared";

/**
 * In-memory mirror of on-chain games, kept in sync by the event listener.
 * Swap for Postgres/Redis when scaling beyond one server instance.
 */
export class LobbyStore {
  private games = new Map<string, LobbyGame>();
  private listeners = new Set<() => void>();

  upsertCreated(
    gameId: string,
    creator: Address,
    stake: string,
    maxPlayers: number,
    createdAt: number
  ): void {
    this.games.set(gameId, {
      gameId,
      creator,
      stake,
      maxPlayers,
      playerCount: 1,
      status: "open",
      createdAt,
    });
    this.notify();
  }

  /** A seat filled — bump the count, flip to "active" once the table is full. */
  markJoined(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.playerCount = Math.min(game.maxPlayers, game.playerCount + 1);
    if (game.playerCount >= game.maxPlayers) game.status = "active";
    this.notify();
  }

  markStatus(gameId: string, status: LobbyGameStatus): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.status = status;
    this.notify();
  }

  get(gameId: string): LobbyGame | undefined {
    return this.games.get(gameId);
  }

  /** Games shown in the lobby: open ones first, then in-play. */
  list(): LobbyGame[] {
    return [...this.games.values()]
      .filter((g) => g.status === "open" || g.status === "active")
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
