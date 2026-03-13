import type { GameState, GameAction } from '../core/types';
import { CREATURE_INFO } from '../core/types';

interface GameOverScreenProps {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
}

export function GameOverScreen({ state, dispatch }: GameOverScreenProps) {
  const winner = state.winner!;

  // プレイヤーを順位付け: 勝者 → 生存者 → 脱落者（逆順）
  const sortedPlayers = [...state.players].sort((a, b) => {
    if (a.playerId === winner.playerId) return -1;
    if (b.playerId === winner.playerId) return 1;
    if (a.isEliminated && !b.isEliminated) return 1;
    if (!a.isEliminated && b.isEliminated) return -1;
    return a.tableCards.length - b.tableCards.length;
  });

  const handleRestart = () => {
    const players = state.players.map(p => ({ name: p.displayName }));
    dispatch({ type: 'START_GAME', players });
  };

  return (
    <div className="gameover-screen">
      <h1>🏆 ゲーム終了！</h1>
      <p className="winner-name">
        🎉 {winner.displayName} の勝利！
      </p>

      <div className="player-results">
        {sortedPlayers.map((player, i) => (
          <div
            key={player.playerId}
            className={`player-result-row ${player.playerId === winner.playerId ? 'winner' : ''} ${player.isEliminated ? 'eliminated' : ''}`}
          >
            <span>
              {i === 0 ? '👑' : player.isEliminated ? '💀' : '✅'}{' '}
              {player.displayName}
            </span>
            <div className="table-cards-summary">
              {player.tableCards.map((card, j) => (
                <span key={j} style={{ fontSize: '0.9rem' }}>
                  {CREATURE_INFO[card.creatureType].emoji}
                </span>
              ))}
              {player.tableCards.length === 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>公開カードなし</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button className="btn btn-primary" onClick={handleRestart} style={{ fontSize: '1.1rem', padding: '14px 36px' }}>
          🔄 同じメンバーで再戦
        </button>
        <button className="btn btn-outline" onClick={() => window.location.reload()} style={{ fontSize: '1.1rem', padding: '14px 36px' }}>
          🏠 タイトルに戻る
        </button>
      </div>
    </div>
  );
}
