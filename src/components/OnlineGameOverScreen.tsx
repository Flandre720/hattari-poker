/**
 * オンライン用ゲームオーバー画面
 */

import { useState } from 'react';
import type { GameStateView } from '../../shared/types';
import { CREATURE_INFO, CREATURE_TYPES } from '../../shared/types';
import { ReplayModal } from './ReplayModal';

interface OnlineGameOverScreenProps {
  gameState: GameStateView;
  onRematch: () => Promise<void>;
  onLeaveRoom: () => void;
}

export function OnlineGameOverScreen({ gameState, onRematch, onLeaveRoom }: OnlineGameOverScreenProps) {
  const winner = gameState.winner!;
  const [rematchRequested, setRematchRequested] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  const sortedPlayers = [...gameState.players].sort((a, b) => {
    if (a.playerId === winner.playerId) return -1;
    if (b.playerId === winner.playerId) return 1;
    if (a.isEliminated && !b.isEliminated) return 1;
    if (!a.isEliminated && b.isEliminated) return -1;
    return a.tableCards.length - b.tableCards.length;
  });

  const isWinner = winner.playerId === gameState.myPlayerId;

  const handleRematch = async () => {
    setRematchRequested(true);
    try {
      await onRematch();
    } catch {
      setRematchRequested(false);
    }
  };

  return (
    <div className="gameover-screen">
      <h1>{isWinner ? '🏆 あなたの勝利！' : '🏆 ゲーム終了！'}</h1>
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
              {player.playerId === gameState.myPlayerId && ' (あなた)'}
            </span>
            <div className="table-cards-summary">
              {[...player.tableCards].sort((a, b) => CREATURE_TYPES.indexOf(a.creatureType) - CREATURE_TYPES.indexOf(b.creatureType)).map((card, j) => (
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

      {/* 称号表示 */}
      {gameState.titles && (
        <div className="titles-section">
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>🏅 称号</h2>
          {sortedPlayers.map(player => {
            const playerTitles = gameState.titles![player.playerId];
            if (!playerTitles || playerTitles.length === 0) return null;
            return (
              <div key={player.playerId} className="player-titles">
                <span className="player-titles-name">{player.displayName}</span>
                <div className="title-badges">
                  {playerTitles.map((title, i) => (
                    <span key={i} className="title-badge" title={title.description}>
                      {title.emoji} {title.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          className="btn btn-success"
          onClick={handleRematch}
          disabled={rematchRequested}
          style={{ fontSize: '1.1rem', padding: '14px 36px' }}
        >
          {rematchRequested ? '⏳ 他のプレイヤーを待っています...' : '🔄 もう一戦！'}
        </button>
        {gameState.replayLog && gameState.replayLog.length > 0 && (
          <button
            className="btn btn-outline replay-btn"
            onClick={() => setShowReplay(true)}
            style={{ fontSize: '1.1rem', padding: '14px 36px' }}
          >
            📜 リプレイ
          </button>
        )}
        <button
          className="btn btn-outline"
          onClick={onLeaveRoom}
          style={{ fontSize: '1.1rem', padding: '14px 36px' }}
        >
          🏠 ロビーに戻る
        </button>
      </div>

      {/* リプレイモーダル */}
      {showReplay && gameState.replayLog && (
        <ReplayModal replayLog={gameState.replayLog} onClose={() => setShowReplay(false)} />
      )}
    </div>
  );
}
