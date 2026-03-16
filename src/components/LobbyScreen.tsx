/**
 * ロビー画面 — ルーム作成・参加・待機
 */

import { useState, useEffect, useRef } from 'react';
import type { RoomInfo, GameMode, EventInterval } from '../../shared/types';
import { useSecretMode } from '../core/SecretModeContext';

interface LobbyScreenProps {
  room: RoomInfo | null;
  myPlayerId: string | null;
  connected: boolean;
  error: string | null;
  onCreateRoom: (playerName: string, maxPlayers?: number, gameMode?: string, eventInterval?: number | string, secretMode?: boolean, turnTimeout?: number, survivalMode?: boolean) => Promise<string>;
  onJoinRoom: (roomId: string, playerName: string) => Promise<void>;
  onStartGame: () => Promise<void>;
  onJoinAsSpectator: (roomId: string) => Promise<void>;
  onLeaveRoom: () => void;
}

export function LobbyScreen({
  room, myPlayerId, connected, error,
  onCreateRoom, onJoinRoom, onStartGame, onJoinAsSpectator, onLeaveRoom,
}: LobbyScreenProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [gameMode, setGameMode] = useState<GameMode>('normal');
  const [eventInterval, setEventInterval] = useState<EventInterval>(3);
  const [turnTimeout, setTurnTimeout] = useState(180);
  const [survivalMode, setSurvivalMode] = useState(false);
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [loading, setLoading] = useState(false);
  const { isSecretMode, activateSecretMode } = useSecretMode();
  const [showSecretFlash, setShowSecretFlash] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const keySequenceRef = useRef<string[]>([]);
  const KONAMI_CODE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight'];

  // コナミコマンド検知
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keySequenceRef.current.push(e.key);
      // 最新の8キーだけ保持
      if (keySequenceRef.current.length > KONAMI_CODE.length) {
        keySequenceRef.current = keySequenceRef.current.slice(-KONAMI_CODE.length);
      }
      // シーケンス一致チェック
      if (keySequenceRef.current.length === KONAMI_CODE.length &&
          keySequenceRef.current.every((k, i) => k === KONAMI_CODE[i])) {
        if (!isSecretMode) {
          activateSecretMode();
          setShowSecretFlash(true);
          setTimeout(() => setShowSecretFlash(false), 3000);
        }
        keySequenceRef.current = [];
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSecretMode, activateSecretMode]);

  const isHost = room && myPlayerId === room.hostPlayerId;
  const canStart = room && room.players.length >= 2;

  // ── ルームに参加済み：待機画面 ──
  if (room) {
    return (
      <div className="lobby-screen">
        <img src="/images/title_logo.png" alt="はったりポーカー" className="title-logo-img" />
        <div className="lobby-card">
          <div className="room-id-display">
            <span className="room-id-label">ルームID</span>
            <span className="room-id-value">{room.roomId}</span>
            <button
              className="btn btn-outline btn-copy"
              onClick={() => {
                const text = room.roomId;
                if (navigator.clipboard && window.isSecureContext) {
                  navigator.clipboard.writeText(text);
                } else {
                  // HTTP環境用フォールバック
                  const textarea = document.createElement('textarea');
                  textarea.value = text;
                  textarea.style.position = 'fixed';
                  textarea.style.opacity = '0';
                  document.body.appendChild(textarea);
                  textarea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textarea);
                }
                const btn = document.querySelector('.btn-copy');
                if (btn) {
                  const orig = btn.textContent;
                  btn.textContent = '✅ コピーしました';
                  setTimeout(() => { btn.textContent = orig; }, 1500);
                }
              }}
            >
              📋 コピー
            </button>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            🎮 モード: {room.gameMode === 'normal' ? 'ノーマル' : room.gameMode === 'event' ? 'イベント' : 'スキル'}
            {room.gameMode === 'event' && ` / 間隔: ${room.eventInterval === 'random' ? 'ランダム' : `${room.eventInterval}ターンごと`}`}
            {room.survivalMode && ' / 🏆 サバイバル'}
          </p>

          <h2>参加プレイヤー ({room.players.length}/{room.maxPlayers})</h2>
          <div className="player-list">
            {room.players.map(p => (
              <div
                key={p.playerId}
                className={`player-item ${p.playerId === myPlayerId ? 'is-me' : ''}`}
              >
                <span>{p.playerId === room.hostPlayerId ? '👑' : '👤'} {p.displayName}</span>
                {p.playerId === myPlayerId && <span className="you-badge">あなた</span>}
              </div>
            ))}
          </div>

          {!canStart && (
            <p className="waiting-text">他のプレイヤーの参加を待っています...</p>
          )}

          <div className="lobby-actions">
            {isHost && (
              <button
                className="btn btn-primary"
                disabled={!canStart}
                onClick={async () => {
                  setLoading(true);
                  try { await onStartGame(); }
                  catch { /* error handled by hook */ }
                  finally { setLoading(false); }
                }}
              >
                {loading ? '⏳ 開始中...' : '🎮 ゲーム開始'}
              </button>
            )}
            {!isHost && canStart && (
              <p className="waiting-text">ホストがゲームを開始するのを待っています...</p>
            )}
            <button className="btn btn-outline" onClick={onLeaveRoom}>
              退出
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── メニュー画面 ──
  if (mode === 'menu') {
    return (
      <div className="lobby-screen">
        <img src="/images/title_logo.png" alt="はったりポーカー" className="title-logo-img" />
        <p className="subtitle">オンライン対戦</p>

        {!connected && (
          <p className="error-text">⚠️ サーバーに接続中...</p>
        )}

        <div className="lobby-card">
          <button
            className="btn btn-primary lobby-btn"
            disabled={!connected}
            onClick={() => setMode('create')}
          >
            🏠 ルームを作る
          </button>
          <button
            className="btn btn-success lobby-btn"
            disabled={!connected}
            onClick={() => setMode('join')}
          >
            🚪 ルームに参加
          </button>
        </div>

        {error && <p className="error-text">❌ {error}</p>}

        <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1.2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href="https://forms.gle/VLznVmnQQQaB2TwD7"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
            style={{ fontSize: '0.9rem', padding: '8px 20px' }}
          >
            📝 バグ報告・ご要望
          </a>
          <button
            className="btn btn-outline"
            onClick={() => setShowVersionModal(true)}
            style={{ fontSize: '0.9rem', padding: '8px 20px' }}
          >
            📋 v1.0.1
          </button>
        </div>

        {isSecretMode && (
          <p style={{ color: '#ffcc00', fontSize: '0.8rem', marginTop: '0.5rem', textShadow: '0 0 8px rgba(255,204,0,0.5)' }}>
            🐾 ??? モード ON
          </p>
        )}

        {showSecretFlash && (
          <div className="secret-flash-overlay">
            <div className="secret-flash-text">🐾 たぬきモード 解放！</div>
          </div>
        )}

        {showVersionModal && (
          <div className="settings-overlay" onClick={() => setShowVersionModal(false)}>
            <div className="settings-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>📋 バージョン情報</h2>
              <div style={{ textAlign: 'left' }}>
                <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '0.8rem', marginBottom: '1rem' }}>
                  <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>v1.0.1</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>2026.3.16</p>
                  <ul style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.3rem', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
                    <li>プレイログを引き出し式に変更（タブホバーで展開、クリックで固定表示）</li>
                    <li>⚙️/💬ボタンを画面右上に移動（手札との重なりを解消）</li>
                  </ul>
                </div>
                <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '0.8rem', marginBottom: '0.5rem' }}>
                  <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>v1.0.0</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>2026.3.15</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.3rem' }}>🎉 正式版リリース</p>
                </div>
              </div>
              <button className="btn btn-outline" onClick={() => setShowVersionModal(false)} style={{ marginTop: '1rem' }}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── ルーム作成画面 ──
  if (mode === 'create') {
    return (
      <div className="lobby-screen">
        <h1>
          <span className="emoji">🏠</span> ルーム作成
        </h1>
        <div className="lobby-card">
          <label className="input-label">あなたの名前</label>
          <input
            className="player-name-input"
            placeholder="名前を入力"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            maxLength={12}
            autoFocus
          />

          <label className="input-label">最大人数</label>
          <div className="player-count-selector">
            {[2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                className={`player-count-btn ${maxPlayers === n ? 'active' : ''}`}
                onClick={() => setMaxPlayers(n)}
              >
                {n}人
              </button>
            ))}
          </div>

          <label className="input-label">ゲームモード</label>
          <div className="player-count-selector">
            {[
              { value: 'normal' as GameMode, label: '🎮 ノーマル' },
              { value: 'event' as GameMode, label: '🎲 イベント' },
              { value: 'skill' as GameMode, label: '⚡ スキル' },
            ].map(m => (
              <button
                key={m.value}
                className={`player-count-btn ${gameMode === m.value ? 'active' : ''}`}
                onClick={() => setGameMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-1rem', marginBottom: '1rem' }}>
            {gameMode === 'normal' && '通常ルール。ブラフと心理戦のみで勝負！'}
            {gameMode === 'event' && 'ターンごとにランダムイベントが発生。波乱の展開！'}
            {gameMode === 'skill' && 'SP（スキルポイント）を貯めてスキル発動。戦略性UP！'}
          </p>

          {gameMode === 'event' && (
            <>
              <label className="input-label">イベント間隔</label>
              <div className="player-count-selector">
                {([1, 2, 3, 4, 5, 'random'] as EventInterval[]).map(v => (
                  <button
                    key={String(v)}
                    className={`player-count-btn ${eventInterval === v ? 'active' : ''}`}
                    onClick={() => setEventInterval(v)}
                  >
                    {v === 'random' ? 'ランダム' : `${v}T`}
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="input-label">⏱️ ターン制限時間: {turnTimeout}秒</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>60s</span>
            <input
              type="range"
              min={60}
              max={300}
              step={60}
              value={turnTimeout}
              onChange={e => setTurnTimeout(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>300s</span>
          </div>

          {maxPlayers >= 3 && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', cursor: 'pointer' }}
              onClick={() => setSurvivalMode(!survivalMode)}
            >
              <div
                className={`settings-toggle ${survivalMode ? 'on' : 'off'}`}
                style={{ width: 44, height: 24, borderRadius: 12, position: 'relative', background: survivalMode ? 'var(--accent)' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}
              >
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: survivalMode ? 23 : 3, transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>🏆 サバイバルモード（最後の1人まで続行）</span>
            </div>
          )}

          <div className="lobby-actions">
            <button
              className="btn btn-primary"
              disabled={!playerName.trim() || loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await onCreateRoom(playerName.trim(), maxPlayers, gameMode, eventInterval, isSecretMode || undefined, turnTimeout, survivalMode || undefined);
                } catch { /* error handled by hook */ }
                finally { setLoading(false); }
              }}
            >
              {loading ? '⏳ 作成中...' : '作成する'}
            </button>
            <button className="btn btn-outline" onClick={() => setMode('menu')}>
              戻る
            </button>
          </div>
        </div>
        {error && <p className="error-text">❌ {error}</p>}
      </div>
    );
  }

  // ── ルーム参加画面 ──
  return (
    <div className="lobby-screen">
      <h1>
        <span className="emoji">🚪</span> ルームに参加
      </h1>
      <div className="lobby-card">
        <label className="input-label">あなたの名前</label>
        <input
          className="player-name-input"
          placeholder="名前を入力"
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          maxLength={12}
          autoFocus
        />

        <label className="input-label">ルームID</label>
        <input
          className="player-name-input room-id-input"
          placeholder="例: ABC12"
          value={roomIdInput}
          onChange={e => setRoomIdInput(e.target.value.toUpperCase())}
          maxLength={5}
        />

        <div className="lobby-actions">
          <button
            className="btn btn-primary"
            disabled={!playerName.trim() || !roomIdInput.trim() || loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onJoinRoom(roomIdInput.trim(), playerName.trim());
              } catch { /* error handled by hook */ }
              finally { setLoading(false); }
            }}
          >
            {loading ? '⏳ 参加中...' : '参加する'}
          </button>
          <button
            className="btn btn-warning"
            disabled={!roomIdInput.trim() || loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onJoinAsSpectator(roomIdInput.trim());
              } catch { /* error handled by hook */ }
              finally { setLoading(false); }
            }}
          >
            {loading ? '⏳' : '👁️ 観戦する'}
          </button>
          <button className="btn btn-outline" onClick={() => setMode('menu')}>
            戻る
          </button>
        </div>
      </div>
      {error && <p className="error-text">❌ {error}</p>}
    </div>
  );
}
