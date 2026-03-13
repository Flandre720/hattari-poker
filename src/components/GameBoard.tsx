import { useState } from 'react';
import type { GameState, GameAction, CreatureType } from '../core/types';
import { CREATURE_INFO } from '../core/types';
import { getTargetPlayers, getPassableTargets } from '../core/gameEngine';
import { CardComponent } from './CardComponent';
import { DeclarationModal } from './DeclarationModal';

interface GameBoardProps {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
}

export function GameBoard({ state, dispatch }: GameBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [showDeclaration, setShowDeclaration] = useState(false);
  const [declarationContext, setDeclarationContext] = useState<'select' | 'pass'>('select');

  const currentPlayer = state.players[state.currentPlayerIndex];

  // ── プレイヤー切り替え画面 ─────────────────────
  if (state.phase === 'PLAYER_SWITCHING') {
    return (
      <div className="switching-screen">
        <h2>🔄 プレイヤー交代</h2>
        <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
          {currentPlayer.displayName} の番です
        </p>
        <p>端末を{currentPlayer.displayName}に渡してください</p>
        <button
          className="btn btn-primary pulse"
          onClick={() => dispatch({ type: 'PLAYER_READY' })}
          style={{ fontSize: '1.2rem', padding: '16px 48px', marginTop: '1rem' }}
        >
          準備OK
        </button>
      </div>
    );
  }

  // ── チャレンジ結果表示 ─────────────────────────
  if (state.phase === 'REVEAL_RESULT' && state.revealResult) {
    const { card, declaredType, wasHonest, loserId } = state.revealResult;
    const loser = state.players.find(p => p.playerId === loserId)!;
    const actualInfo = CREATURE_INFO[card.creatureType];
    const declaredInfo = CREATURE_INFO[declaredType];

    return (
      <div className="switching-screen">
        <div className="reveal-result">
          <CardComponent card={card} large />
          <div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              宣言: {declaredInfo.emoji} {declaredInfo.name}
            </p>
            <p style={{ color: 'var(--text-secondary)' }}>
              実際: {actualInfo.emoji} {actualInfo.name}
            </p>
          </div>
          <p className={`result-text ${wasHonest ? 'honest' : 'liar'}`}>
            {wasHonest ? '✅ 正直だった！' : '❌ 嘘だった！'}
          </p>
          <p>
            <strong>{loser.displayName}</strong> がカードを引き取ります
          </p>
          <button
            className="btn btn-primary"
            onClick={() => dispatch({ type: 'CONFIRM_RESULT' })}
            style={{ marginTop: '1rem' }}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // ── メインゲームボード ────────────────────────
  const targets = state.phase === 'ACTIVE_PLAYER_TURN' ? getTargetPlayers(state) : [];
  const passableTargets = (state.phase === 'PEEKING') ? getPassableTargets(state) : [];

  const handleCardClick = (cardId: string) => {
    if (state.phase !== 'ACTIVE_PLAYER_TURN') return;
    setSelectedCardId(prev => prev === cardId ? null : cardId);
    setSelectedTarget(null);
  };

  const handleTargetClick = (playerId: string) => {
    if (state.phase === 'ACTIVE_PLAYER_TURN' && selectedCardId) {
      setSelectedTarget(playerId);
      setDeclarationContext('select');
      setShowDeclaration(true);
    } else if (state.phase === 'PEEKING') {
      setSelectedTarget(playerId);
      setDeclarationContext('pass');
      setShowDeclaration(true);
    }
  };

  const handleDeclare = (declaredType: CreatureType) => {
    setShowDeclaration(false);
    if (declarationContext === 'select' && selectedCardId && selectedTarget) {
      dispatch({
        type: 'SELECT_CARD',
        cardId: selectedCardId,
        targetPlayerId: selectedTarget,
        declaredType,
      });
      setSelectedCardId(null);
      setSelectedTarget(null);
    } else if (declarationContext === 'pass' && selectedTarget) {
      dispatch({
        type: 'PASS_CARD',
        targetPlayerId: selectedTarget,
        declaredType,
      });
      setSelectedTarget(null);
    }
  };

  const isSelectingTarget = state.phase === 'ACTIVE_PLAYER_TURN' && selectedCardId !== null;
  const isPeeking = state.phase === 'PEEKING';

  return (
    <div className="game-board">
      {/* ヘッダー */}
      <div className="game-header">
        <span className="current-player">
          {currentPlayer.displayName} のターン
        </span>
        <span className="turn-info">Turn {state.turnCount}</span>
      </div>

      {/* 対戦相手エリア */}
      <div className="opponents-area">
        {state.players
          .filter(p => p.playerId !== currentPlayer.playerId)
          .map(player => {
            const isTarget = (isSelectingTarget && targets.some(t => t.playerId === player.playerId))
              || (isPeeking && passableTargets.some(t => t.playerId === player.playerId));
            return (
              <div
                key={player.playerId}
                className={`opponent-panel ${player.isEliminated ? 'eliminated' : ''} ${isTarget ? 'selectable' : ''}`}
                onClick={isTarget ? () => handleTargetClick(player.playerId) : undefined}
              >
                <div className="opponent-name">
                  {player.isEliminated ? '💀' : '👤'} {player.displayName}
                </div>
                <div className="opponent-hand-count">
                  手札: {player.hand.length}枚
                </div>
                {player.tableCards.length > 0 && (
                  <div className="opponent-table-cards">
                    {player.tableCards.map((card, i) => {
                      const info = CREATURE_INFO[card.creatureType];
                      return (
                        <div key={i} className="mini-card" style={{ backgroundColor: info.color }}>
                          {info.emoji}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* 中央エリア */}
      <div className="center-area">
        {state.phase === 'ACTIVE_PLAYER_TURN' && !selectedCardId && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            手札からカードを1枚選んでください
          </p>
        )}

        {state.phase === 'ACTIVE_PLAYER_TURN' && selectedCardId && (
          <p style={{ color: 'var(--warning)', fontSize: '1.1rem' }}>
            カードを渡す相手を選んでください ⬆️
          </p>
        )}

        {state.phase === 'WAITING_RECEIVER_ACTION' && state.passingCard && (
          <div className="passing-card-display">
            <p style={{ color: 'var(--text-secondary)' }}>
              {state.players.find(p => p.playerId === state.passingCard!.fromPlayerId)?.displayName} から
            </p>
            <CardComponent faceDown large />
            <p className="declaration-text">
              「これは {CREATURE_INFO[state.passingCard.declaredType].emoji}{' '}
              {CREATURE_INFO[state.passingCard.declaredType].name} だ」
            </p>
            <div className="action-buttons">
              <button className="btn btn-danger btn-primary" onClick={() => dispatch({ type: 'CHALLENGE' })}>
                🔍 開示する（チャレンジ）
              </button>
              <button className="btn btn-warning" onClick={() => dispatch({ type: 'PEEK_CARD' })}>
                👀 確認して回す
              </button>
            </div>
          </div>
        )}

        {state.phase === 'PEEKING' && state.passingCard && (
          <div className="passing-card-display">
            <p style={{ color: 'var(--text-secondary)' }}>カードの正体:</p>
            <CardComponent card={state.passingCard.card} large />
            <p style={{ color: 'var(--warning)', fontSize: '1.1rem', marginTop: '0.5rem' }}>
              回す相手を選んでください ⬆️
            </p>
          </div>
        )}
      </div>

      {/* 自分のテーブルカード */}
      {currentPlayer.tableCards.length > 0 && (
        <div className="hand-area">
          <div className="hand-label">
            あなたの公開カード ({currentPlayer.tableCards.length}枚)
          </div>
          <div className="hand-cards">
            {currentPlayer.tableCards.map((card, i) => (
              <CardComponent key={i} card={card} disabled />
            ))}
          </div>
        </div>
      )}

      {/* 手札エリア */}
      {state.phase === 'ACTIVE_PLAYER_TURN' && (
        <div className="hand-area">
          <div className="hand-label">
            あなたの手札 ({currentPlayer.hand.length}枚)
          </div>
          <div className="hand-cards">
            {currentPlayer.hand.map(card => (
              <CardComponent
                key={card.cardId}
                card={card}
                selected={selectedCardId === card.cardId}
                onClick={() => handleCardClick(card.cardId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 宣言モーダル */}
      {showDeclaration && (
        <DeclarationModal
          title={declarationContext === 'select' ? '宣言する生き物を選択' : '宣言を変更（または維持）'}
          onSelect={handleDeclare}
          onCancel={() => {
            setShowDeclaration(false);
            setSelectedTarget(null);
          }}
        />
      )}
    </div>
  );
}
