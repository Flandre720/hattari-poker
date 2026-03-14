/**
 * オンライン用ゲームボード
 * サーバーから受信した GameStateView で描画
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameStateView, CreatureType, ReplayEntry } from '../../shared/types';
import { CREATURE_INFO, CREATURE_TYPES } from '../../shared/types';
import { CardComponent } from './CardComponent';
import { DeclarationModal } from './DeclarationModal';
import { useSoundEffects } from '../core/useSoundEffects';
import { useSecretMode } from '../core/SecretModeContext';
import { useSettings } from '../core/SettingsContext';

/** 隠しモード時のCREATURE_INFOオーバーライド */
function useCreatureInfo() {
  const { isSecretMode } = useSecretMode();
  return useMemo(() => {
    if (!isSecretMode) return CREATURE_INFO;
    return {
      ...CREATURE_INFO,
      SCORPION: { name: 'タヌキ', emoji: '', color: '#D4A574' },
    };
  }, [isSecretMode]);
}

/** turnDeadlineからリアルタイムの残り秒数を返すフック */
function useCountdown(deadline: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const update = () => {
      const diff = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(diff);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return remaining;
}

interface OnlineGameBoardProps {
  gameState: GameStateView;
  selectCard: (cardId: string, targetPlayerId: string, declaredType: CreatureType) => Promise<void>;
  challenge: (believeIsLying: boolean) => Promise<void>;
  peekCard: () => Promise<void>;
  passCard: (targetPlayerId: string, declaredType: CreatureType) => Promise<void>;
  confirmResult: () => Promise<void>;
  useSkill?: (skillType: string, targetPlayerId?: string, tableCardIndex?: number) => Promise<void>;
  changeSelectTarget?: (targetPlayerId: string) => Promise<void>;
  salvationSelectTarget?: (targetPlayerId: string) => Promise<void>;
}

export function OnlineGameBoard({
  gameState, selectCard, challenge, peekCard, passCard, confirmResult, useSkill, changeSelectTarget, salvationSelectTarget,
}: OnlineGameBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [showDeclaration, setShowDeclaration] = useState(false);
  const [declarationContext, setDeclarationContext] = useState<'select' | 'pass'>('select');
  const [showEventAnnounce, setShowEventAnnounce] = useState(false);
  const [eventAnnounceFading, setEventAnnounceFading] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [cardFlying, setCardFlying] = useState(false);
  const [showTurnAnnounce, setShowTurnAnnounce] = useState(false);
  const [turnAnnounceFading, setTurnAnnounceFading] = useState(false);
  const [playLogPinned, setPlayLogPinned] = useState(false);
  const { settings } = useSettings();
  const { play: playSound } = useSoundEffects(settings.seVolume / 100);
  const prevTurnRef = useRef<string | null>(null);
  const { isSecretMode } = useSecretMode();
  const creatureInfo = useCreatureInfo();
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmIndexRef = useRef<number>(0);

  const BGM_TRACKS = ['/bgm1.mp3', '/bgm2.mp3', '/bgm3.mp3'];

  // BGM再生管理
  useEffect(() => {
    // たぬきモード: poro.mp3のみ
    if (isSecretMode) {
      // 通常BGMが鳴っていたら停止
      if (bgmRef.current && !bgmRef.current.src.includes('poro.mp3')) {
        bgmRef.current.pause();
        bgmRef.current = null;
      }
      if (!bgmRef.current) {
        bgmRef.current = new Audio('/images/poro.mp3');
        bgmRef.current.loop = true;
        bgmRef.current.volume = settings.bgmVolume / 200;
        bgmRef.current.play().catch(() => { /* autoplay blocked */ });
      } else {
        bgmRef.current.volume = settings.bgmVolume / 200;
      }
      return () => {
        if (bgmRef.current) {
          bgmRef.current.pause();
          bgmRef.current = null;
        }
      };
    }

    // 通常BGM: 3曲ローテーション
    const playBgm = (index: number) => {
      const track = BGM_TRACKS[index % BGM_TRACKS.length];
      const audio = new Audio(track);
      audio.volume = settings.bgmVolume / 200;
      audio.onended = () => {
        bgmIndexRef.current = (bgmIndexRef.current + 1) % BGM_TRACKS.length;
        playBgm(bgmIndexRef.current);
      };
      bgmRef.current = audio;
      audio.play().catch(() => { /* autoplay blocked */ });
    };

    if (!bgmRef.current) {
      // 初回再生: サーバーが指定した開始インデックスから
      bgmIndexRef.current = gameState.bgmStartIndex ?? 0;
      playBgm(bgmIndexRef.current);
    }

    return () => {
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSecretMode]);

  // BGM音量変更時: 曲をリスタートせずvolume更新のみ
  useEffect(() => {
    if (bgmRef.current) {
      bgmRef.current.volume = settings.bgmVolume / 200;
    }
  }, [settings.bgmVolume]);

  const myPlayerId = gameState.myPlayerId;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const isSpectator = myPlayerId.startsWith('__spectator__');
  const isMyTurn = !isSpectator && currentPlayer.playerId === myPlayerId;
  const mePlayer = isSpectator ? null : gameState.players.find(p => p.playerId === myPlayerId) ?? null;

  // イベントが新しく発動したら中央演出を表示
  const currentEventKey = gameState.activeEvent ? `${gameState.activeEvent.type}-${gameState.turnCount}` : null;
  if (currentEventKey && currentEventKey !== lastEventId) {
    setLastEventId(currentEventKey);
    setShowEventAnnounce(true);
    setEventAnnounceFading(false);
    playSound('eventTrigger');
    setTimeout(() => setEventAnnounceFading(true), 2000);
    setTimeout(() => setShowEventAnnounce(false), 2500);
  } else if (!currentEventKey && lastEventId) {
    setLastEventId(null);
  }
  const remainingSeconds = useCountdown(gameState.turnDeadline);

  // ターンが切り替わったらSEを再生 + ターン通知を表示
  useEffect(() => {
    const turnKey = `${gameState.turnCount}-${gameState.currentPlayerIndex}`;
    if (prevTurnRef.current !== turnKey && gameState.phase === 'ACTIVE_PLAYER_TURN') {
      prevTurnRef.current = turnKey;
      if (isMyTurn) playSound('turnStart');
      // ターン通知演出
      setShowTurnAnnounce(true);
      setTurnAnnounceFading(false);
      const fadeTimer = setTimeout(() => setTurnAnnounceFading(true), 1200);
      const hideTimer = setTimeout(() => setShowTurnAnnounce(false), 1700);
      return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
    }
    prevTurnRef.current = turnKey;
  }, [gameState.turnCount, gameState.currentPlayerIndex, gameState.phase, isMyTurn, playSound]);

  // ── フリップアニメ + カード移動アニメ用state ──────────────────
  const [flipped, setFlipped] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showChallengeDeclaration, setShowChallengeDeclaration] = useState(false);
  const prevPhaseRef = useRef(gameState.phase);
  const playLogRef = useRef<HTMLDivElement>(null);

  // プレイログ自動スクロール
  useEffect(() => {
    if (playLogRef.current) {
      playLogRef.current.scrollTop = playLogRef.current.scrollHeight;
    }
  }, [gameState.replayLog?.length]);

  useEffect(() => {
    // REVEAL_RESULT: チャレンジ宣言表示 → フリップアニメ
    if (gameState.phase === 'REVEAL_RESULT' && prevPhaseRef.current !== 'REVEAL_RESULT') {
      setFlipped(false);
      setShowResult(false);
      setShowChallengeDeclaration(true);
      // 1.5秒後に宣言を消してフリップ開始
      const declTimer = setTimeout(() => setShowChallengeDeclaration(false), 1500);
      const flipTimer = setTimeout(() => setFlipped(true), 2300);
      // フリップ完了後にSE再生
      const seTimer = setTimeout(() => {
        if (gameState.revealResult?.challengerCorrect) {
          playSound('correct');
        } else {
          playSound('wrong');
        }
      }, 2500);
      const resultTimer = setTimeout(() => setShowResult(true), 3100);
      prevPhaseRef.current = gameState.phase;
      return () => { clearTimeout(declTimer); clearTimeout(flipTimer); clearTimeout(seTimer); clearTimeout(resultTimer); };
    }
    // WAITING_RECEIVER_ACTION: カード移動アニメ
    if (gameState.phase === 'WAITING_RECEIVER_ACTION' && prevPhaseRef.current !== 'WAITING_RECEIVER_ACTION') {
      setCardFlying(true);
      playSound('cardPass');
      const timer = setTimeout(() => setCardFlying(false), 700);
      prevPhaseRef.current = gameState.phase;
      return () => clearTimeout(timer);
    }
    prevPhaseRef.current = gameState.phase;
  }, [gameState.phase, playSound]);

  // ── チャレンジ結果表示 ─────────────────────────
  if (gameState.phase === 'REVEAL_RESULT' && gameState.revealResult) {
    const { card, declaredType, challengerBelievesLying, challengerCorrect, loserId } = gameState.revealResult;
    const loser = gameState.players.find(p => p.playerId === loserId)!;
    const actualInfo = creatureInfo[card.creatureType];
    const declaredInfo = creatureInfo[declaredType];

    // チャレンジ宣言テキスト
    const challengeDeclarationText = challengerBelievesLying
      ? `これは ${declaredInfo.emoji} ${declaredInfo.name} じゃない！`
      : `これは ${declaredInfo.emoji} ${declaredInfo.name} だ！`;

    return (
      <div className="switching-screen">
        <div className="reveal-result">
          {/* チャレンジ宣言表示 */}
          {showChallengeDeclaration && (
            <div className="challenge-declaration-overlay">
              <div className="challenge-declaration-text">
                {challengeDeclarationText}
              </div>
            </div>
          )}

          {/* フリップカード */}
          <div className={`flip-card-container ${flipped ? 'flipped' : ''}`}>
            <div className="flip-card-inner">
              <div className="flip-card-back">
                <div className="card card-back card-large">❓</div>
              </div>
              <div className="flip-card-front">
                {flipped && <CardComponent card={card} large />}
              </div>
            </div>
          </div>

          <div className={`reveal-info ${showResult ? 'visible' : ''}`}>
            <div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                宣言: {declaredInfo.emoji} {declaredInfo.name}
              </p>
              <p style={{ color: 'var(--text-secondary)' }}>
                実際: {actualInfo.emoji} {actualInfo.name}
              </p>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
              受け手の予想: {challengerBelievesLying ? '「嘘だと思う」' : '「本当だと思う」'}
            </p>
            <p className={`result-text ${challengerCorrect ? 'honest' : 'liar'}`}>
              {challengerCorrect ? '✅ 予想的中！送り手がカードを引き取ります' : '❌ 予想ハズレ！受け手がカードを引き取ります'}
            </p>
            <p>
              <strong>{loser.displayName}</strong> がカードを引き取ります
            </p>
            {/* OKボタンは全プレイヤーに表示（観戦者含む） */}
            {showResult && (
              <button
                className="btn btn-primary"
                onClick={() => confirmResult()}
                style={{ marginTop: '1rem' }}
              >
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 対象プレイヤーリスト（観戦者は全プレイヤー表示）
  const opponents = isSpectator
    ? gameState.players
    : gameState.players.filter(p => p.playerId !== myPlayerId);

  // カード選択フェーズの対象
  const isSelectingTarget = gameState.phase === 'ACTIVE_PLAYER_TURN' && isMyTurn && selectedCardId !== null;
  const isPeeking = gameState.phase === 'PEEKING' && isMyTurn;

  // パス可能な対象（サーバーから受信済み）
  const passableTargetIds = gameState.passingCard?.passableTargetIds ?? [];
  const canPeekAndPass = passableTargetIds.length > 0;

  const handleCardClick = (cardId: string) => {
    if (gameState.phase !== 'ACTIVE_PLAYER_TURN' || !isMyTurn) return;
    setSelectedCardId(prev => prev === cardId ? null : cardId);
    setSelectedTarget(null);
  };

  const handleTargetClick = (playerId: string) => {
    if (isSelectingTarget) {
      setSelectedTarget(playerId);
      setDeclarationContext('select');
      setShowDeclaration(true);
    } else if (isPeeking) {
      setSelectedTarget(playerId);
      setDeclarationContext('pass');
      setShowDeclaration(true);
    }
  };

  const handleDeclare = async (declaredType: CreatureType) => {
    setShowDeclaration(false);
    setCardFlying(true);
    playSound('cardPass');
    setTimeout(() => setCardFlying(false), 600);
    if (declarationContext === 'select' && selectedCardId && selectedTarget) {
      await selectCard(selectedCardId, selectedTarget, declaredType);
      setSelectedCardId(null);
      setSelectedTarget(null);
    } else if (declarationContext === 'pass' && selectedTarget) {
      await passCard(selectedTarget, declaredType);
      setSelectedTarget(null);
    }
  };

  // ── プレイログ ──
  const replayLog = gameState.replayLog || [];
  const logGroups: { turn: number; entries: ReplayEntry[] }[] = [];
  let currentLogTurn = -1;
  for (const entry of replayLog) {
    if (entry.turn !== currentLogTurn) {
      currentLogTurn = entry.turn;
      logGroups.push({ turn: currentLogTurn, entries: [entry] });
    } else {
      logGroups[logGroups.length - 1].entries.push(entry);
    }
  }

  return (
    <div className={`game-board ${isSpectator ? 'spectator-mode' : ''}`}>
      {/* プレイログパネル（引き出し式） */}
      {replayLog.length > 0 && (
        <div className={`play-log-wrapper ${playLogPinned ? 'pinned' : ''}`}>
          <button
            className={`play-log-tab ${playLogPinned ? 'active' : ''}`}
            onClick={() => setPlayLogPinned(prev => !prev)}
            title={playLogPinned ? 'プレイログを閉じる' : 'プレイログを固定表示'}
          >
            📜
          </button>
          <div className="play-log-panel">
            <div className="play-log-header">プレイログ</div>
            <div className="play-log-timeline">
              {logGroups.map((group, gi) => (
                <div key={gi} className="play-log-turn-group">
                  <div className="play-log-turn-label">
                    {group.turn === 0 ? '🎮 開始' : `Turn ${group.turn}`}
                  </div>
                  {group.entries.map((entry, ei) => (
                    <div key={ei} className={`play-log-entry play-log-action-${entry.action.toLowerCase()}`}>
                      <span className="play-log-emoji">{entry.emoji}</span>
                      <div className="play-log-content">
                        {entry.playerName && (
                          <span className="play-log-player">{entry.playerName}</span>
                        )}
                        <span className="play-log-detail">{entry.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* 観戦者バナー */}
      {isSpectator && (
        <div className="spectator-banner">
          <span className="spectator-icon">👁️</span>
          <span>観戦中</span>
          <span className="spectator-info">{gameState.players.length}人が対戦中</span>
        </div>
      )}
      {/* ヘッダー */}
      <div className="game-header">
        <span className="current-player">
          {isMyTurn ? '🟢 あなたのターン' : `⏳ ${currentPlayer.displayName} のターン`}
        </span>
        <span className="turn-info">
          Turn {gameState.turnCount}
          {remainingSeconds !== null && (
            <span
              className="turn-timer"
              style={{
                marginLeft: '0.75rem',
                color: remainingSeconds <= 30 ? 'var(--danger)' : 'var(--text-secondary)',
                fontWeight: remainingSeconds <= 30 ? 'bold' : 'normal',
                animation: remainingSeconds <= 10 ? 'blink 1s infinite' : 'none',
              }}
            >
              ⏱️ {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
            </span>
          )}
        </span>
      </div>

      {/* イベントバナー */}
      {gameState.activeEvent && (
        <div className="event-banner">
          <span className="event-emoji">{gameState.activeEvent.emoji}</span>
          <span className="event-name">{gameState.activeEvent.name}</span>
          <span className="event-desc">{gameState.activeEvent.description}</span>
          {gameState.activeEvent.leakedCards && gameState.activeEvent.leakedCards.length > 0 && (
            <div className="leaked-cards">
              {gameState.activeEvent.leakedCards.map((l, i) => (
                <span key={i} className="leaked-card">
                  {l.playerName}: {creatureInfo[l.card.creatureType].emoji}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 救済イベント: 送り先選択 */}
      {gameState.salvationPending && gameState.salvationPending.length > 0 && salvationSelectTarget && (
        <div className="event-banner" style={{ borderColor: 'rgba(100, 200, 100, 0.5)', background: 'linear-gradient(135deg, rgba(100, 200, 100, 0.2), rgba(100, 200, 100, 0.1))' }}>
          {gameState.salvationPending.some(p => p.playerId === myPlayerId) ? (
            <>
              <span style={{ fontSize: '1.5rem' }}>🙏</span>
              <span style={{ fontWeight: 700, color: 'var(--success)' }}>救済！場カードの送り先を選んでください</span>
              <div className="action-buttons" style={{ flexWrap: 'wrap', marginTop: '0.5rem', width: '100%' }}>
                {gameState.players
                  .filter(p => !p.isEliminated && p.playerId !== myPlayerId)
                  .map(p => (
                    <button key={p.playerId} className="btn btn-primary" onClick={() => salvationSelectTarget(p.playerId)}>
                      {p.displayName}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <>
              <span style={{ fontSize: '1.5rem' }}>🙏</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                救済対象プレイヤーが送り先を選択中...
              </span>
            </>
          )}
        </div>
      )}

      {/* 効果インジケーター */}
      {(gameState.barrierActive || gameState.doubleRiskActive || gameState.lockedDeclareType || gameState.rouletteTarget) && (
        <div className="event-effects">
          {gameState.barrierActive && <span className="effect-badge barrier">🛡️ バリア</span>}
          {gameState.doubleRiskActive && <span className="effect-badge risk">⚡ Wリスク</span>}
          {gameState.lockedDeclareType && <span className="effect-badge lock">🔒 {creatureInfo[gameState.lockedDeclareType].emoji}のみ</span>}
          {gameState.rouletteTarget && (
            <span className="effect-badge roulette">
              🎲 → {gameState.players.find(p => p.playerId === gameState.rouletteTarget)?.displayName}
            </span>
          )}
          <span className="event-duration">このターンのみ有効</span>
        </div>
      )}

      {/* 対戦相手エリア */}
      <div className="opponents-area">
        {opponents.map(player => {
          const isTarget =
            (isSelectingTarget && !player.isEliminated) ||
            (isPeeking && passableTargetIds.includes(player.playerId));
          return (
            <div
              key={player.playerId}
              className={`opponent-panel ${player.isEliminated ? 'eliminated' : ''} ${isTarget ? 'selectable' : ''}`}
              onClick={isTarget ? () => handleTargetClick(player.playerId) : undefined}
            >
              <div className="opponent-name">
                {player.isEliminated ? '💀' : (player.playerId === currentPlayer.playerId ? '🔵' : '👤')} {player.displayName}
              </div>
              <div className="opponent-hand-count">
                手札: {player.handCount}枚
              </div>
              {player.tableCards.length > 0 && (
                <div className="opponent-table-cards">
                  {[...player.tableCards].sort((a, b) => CREATURE_TYPES.indexOf(a.creatureType) - CREATURE_TYPES.indexOf(b.creatureType)).map((card, i) => {
                    const info = creatureInfo[card.creatureType];
                    return (
                      <div key={i} className="mini-card" style={{ backgroundColor: info.color }}>
                        {info.emoji || <img src="/images/poro.png" alt="タヌキ" style={{ width: '1em', height: '1em', objectFit: 'contain' }} />}
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
        {gameState.phase === 'ACTIVE_PLAYER_TURN' && isMyTurn && !selectedCardId && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            手札からカードを1枚選んでください
          </p>
        )}

        {gameState.phase === 'ACTIVE_PLAYER_TURN' && isMyTurn && selectedCardId && (
          <p style={{ color: 'var(--warning)', fontSize: '1.1rem' }}>
            カードを渡す相手を選んでください ⬆️
          </p>
        )}

        {gameState.phase === 'ACTIVE_PLAYER_TURN' && !isMyTurn && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            {currentPlayer.displayName} がカードを選んでいます...
          </p>
        )}

        {/* チェンジスキル: 送り手がターゲットを選び直す */}
        {gameState.phase === 'WAITING_RECEIVER_ACTION' && gameState.changePending && gameState.passingCard && changeSelectTarget && (
          <div className="passing-card-display">
            {gameState.passingCard.fromPlayerId === gameState.myPlayerId ? (
              <>
                <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1.1rem' }}>
                  🔀 チェンジ！カードの渡し先を選び直してください
                </p>
                <div className="action-buttons" style={{ flexWrap: 'wrap' }}>
                  {gameState.players
                    .filter(p =>
                      !p.isEliminated &&
                      p.playerId !== gameState.myPlayerId &&
                      p.playerId !== gameState.passingCard!.toPlayerId
                    )
                    .map(p => (
                      <button
                        key={p.playerId}
                        className="btn btn-primary"
                        onClick={() => changeSelectTarget(p.playerId)}
                      >
                        {p.displayName}
                      </button>
                    ))}
                </div>
              </>
            ) : gameState.passingCard.toPlayerId === gameState.myPlayerId ? (
              <p style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>
                🔀 チェンジ発動！相手がカードの送り先を選び直しています...
              </p>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                🔀 チェンジ発動中...
              </p>
            )}
          </div>
        )}

        {gameState.phase === 'WAITING_RECEIVER_ACTION' && gameState.passingCard && !gameState.changePending && (
          <div className="passing-card-display">
            <p style={{ color: 'var(--text-secondary)' }}>
              {gameState.players.find(p => p.playerId === gameState.passingCard!.fromPlayerId)?.displayName} から{' '}
              {gameState.players.find(p => p.playerId === gameState.passingCard!.toPlayerId)?.displayName} へ
            </p>
            <CardComponent faceDown large />
            <p className="declaration-text">
              「これは {creatureInfo[gameState.passingCard.declaredType].emoji}{' '}
              {creatureInfo[gameState.passingCard.declaredType].name} だ」
            </p>
            {isMyTurn ? (
              <div className="action-buttons">
                <button className="btn btn-success" onClick={() => { playSound('challenge'); challenge(false); }}>
                  ✅ 本当だと思う
                </button>
                <button className="btn btn-danger" onClick={() => { playSound('challenge'); challenge(true); }}>
                  ❌ 嘘だと思う
                </button>
                {canPeekAndPass && (
                  <button className="btn btn-warning" onClick={() => peekCard()}>
                    👀 確認して回す
                  </button>
                )}
              </div>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                {currentPlayer.displayName} が判断中...
              </p>
            )}
          </div>
        )}

        {gameState.phase === 'PEEKING' && gameState.passingCard && (
          <div className="passing-card-display">
            {isMyTurn && gameState.passingCard.card ? (
              <>
                <p style={{ color: 'var(--text-secondary)' }}>カードの正体:</p>
                <CardComponent card={gameState.passingCard.card} large />
                <p style={{ color: 'var(--warning)', fontSize: '1.1rem', marginTop: '0.5rem' }}>
                  回す相手を選んでください ⬆️
                </p>
              </>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                {currentPlayer.displayName} がカードを確認して回そうとしています...
              </p>
            )}
          </div>
        )}
      </div>

      {/* スキルパネル（スキルモード時のみ） */}
      {gameState.gameMode === 'skill' && useSkill && mePlayer && (
        <div className="skill-panel">
          <div className="sp-display">
            ⚡ SP: {mePlayer.sp} / 5
            <div className="sp-bar">
              <div className="sp-fill" style={{ width: `${(mePlayer.sp / 5) * 100}%` }} />
            </div>
          </div>
          <div className="skill-buttons">
            {gameState.phase === 'WAITING_RECEIVER_ACTION' && isMyTurn && (
              <>
                <button
                  className="btn btn-sm skill-btn attack"
                  disabled={mePlayer.sp < 3}
                  onClick={() => { playSound('skillUse'); useSkill('ATTACK'); }}
                  title="チャレンジ成功時、場カード最少プレイヤーにカードを送る (3SP)"
                >
                  ⚔️ アタック (3)
                </button>
                <button
                  className="btn btn-sm skill-btn change"
                  disabled={mePlayer.sp < 2}
                  onClick={() => { playSound('skillUse'); useSkill('CHANGE'); }}
                  title="カードの渡し先を別のプレイヤーに変更 (2SP)"
                >
                  🔀 チェンジ (2)
                </button>
              </>
            )}
            {gameState.phase === 'PEEKING' && isMyTurn && (
              <button
                className="btn btn-sm skill-btn shield"
                disabled={mePlayer.sp < 4}
                onClick={() => { playSound('skillUse'); useSkill('SHIELD'); }}
                title="パス先がチャレンジ不可 (4SP)"
              >
                🛡️ シールド (4)
              </button>
            )}
            {gameState.phase === 'ACTIVE_PLAYER_TURN' && isMyTurn && mePlayer.tableCards.length > 0 && (
              <button
                className="btn btn-sm skill-btn heal"
                disabled={mePlayer.sp < 5}
                onClick={() => { playSound('skillUse'); useSkill('HEAL'); }}
                title="場のカード1枚を手札に戻す (5SP)"
              >
                💚 ヒール (5)
              </button>
            )}
          </div>
        </div>
      )}

      {/* 自分のテーブルカード */}
      {mePlayer && mePlayer.tableCards.length > 0 && (
        <div className="hand-area">
          <div className="hand-label">
            あなたの公開カード ({mePlayer.tableCards.length}枚)
          </div>
          <div className="hand-cards">
            {[...mePlayer.tableCards].sort((a, b) => CREATURE_TYPES.indexOf(a.creatureType) - CREATURE_TYPES.indexOf(b.creatureType)).map((card, i) => (
              <CardComponent key={i} card={card} disabled />
            ))}
          </div>
        </div>
      )}

      {/* 手札エリア */}
      {mePlayer && mePlayer.hand && mePlayer.hand.length > 0 && (
        <div className="hand-area">
          <div className="hand-label">
            あなたの手札 ({mePlayer.hand.length}枚)
          </div>
          <div className="hand-cards">
            {mePlayer.hand.map(card => (
              <CardComponent
                key={card.cardId}
                card={card}
                selected={selectedCardId === card.cardId}
                onClick={() => handleCardClick(card.cardId)}
                disabled={!isMyTurn || gameState.phase !== 'ACTIVE_PLAYER_TURN'}
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
          lockedType={gameState.lockedDeclareType}
        />
      )}

      {/* イベント開始演出 */}
      {showEventAnnounce && gameState.activeEvent && (
        <div className={`event-announce-overlay ${eventAnnounceFading ? 'fading' : ''}`} onClick={() => setShowEventAnnounce(false)}>
          <div className="event-announce-card" onClick={e => e.stopPropagation()}>
            <span className={`event-announce-emoji ${gameState.activeEvent.type === 'ROULETTE' ? 'dice-spin' : ''}`}>
              {gameState.activeEvent.emoji}
            </span>
            <span className="event-announce-name">{gameState.activeEvent.name}</span>
            <span className="event-announce-desc">{gameState.activeEvent.description}</span>
          </div>
        </div>
      )}

      {/* ターン開始通知 */}
      {showTurnAnnounce && (
        <div className={`turn-announce-overlay ${turnAnnounceFading ? 'fading' : ''}`} onClick={() => setShowTurnAnnounce(false)}>
          <div className="turn-announce-card" onClick={e => e.stopPropagation()}>
            <span className="turn-announce-emoji">{isMyTurn ? '🟢' : '⏳'}</span>
            <span className={`turn-announce-text ${isMyTurn ? 'my-turn' : ''}`}>
              {isMyTurn ? 'あなたのターンです' : `${currentPlayer.displayName} のターンです`}
            </span>
          </div>
        </div>
      )}

      {/* カード移動アニメーション */}
      {cardFlying && (
        <div className="flying-card-overlay">
          <div className="flying-card">
            <div className="card card-back" style={{ width: 60, height: 84 }}>❓</div>
          </div>
        </div>
      )}
    </div>
  );
}
