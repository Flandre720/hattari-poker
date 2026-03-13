/**
 * 設定モーダル — 歯車アイコンで開閉
 */

import { useState } from 'react';
import { useSettings } from '../core/SettingsContext';

interface SettingsButtonProps {
  onLeaveRoom?: () => void;
}

export function SettingsButton({ onLeaveRoom }: SettingsButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="settings-gear-btn"
        onClick={() => setOpen(true)}
        title="設定"
        aria-label="設定を開く"
      >
        ⚙️
      </button>
      {open && <SettingsModal onClose={() => setOpen(false)} onLeaveRoom={onLeaveRoom} />}
    </>
  );
}

function SettingsModal({ onClose, onLeaveRoom }: { onClose: () => void; onLeaveRoom?: () => void }) {
  const { settings, updateSetting, resetSettings } = useSettings();
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const handleLeave = () => {
    onLeaveRoom?.();
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ 設定</h2>
          <button className="settings-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* BGM音量 */}
          <div className="settings-item">
            <label className="settings-label">🎵 BGM音量</label>
            <div className="settings-slider-row">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.bgmVolume}
                onChange={e => updateSetting('bgmVolume', Number(e.target.value))}
                className="settings-slider"
              />
              <span className="settings-value">{settings.bgmVolume}%</span>
            </div>
          </div>

          {/* SE音量 */}
          <div className="settings-item">
            <label className="settings-label">🔊 SE音量</label>
            <div className="settings-slider-row">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.seVolume}
                onChange={e => updateSetting('seVolume', Number(e.target.value))}
                className="settings-slider"
              />
              <span className="settings-value">{settings.seVolume}%</span>
            </div>
          </div>

          {/* 通知音 */}
          <div className="settings-item">
            <label className="settings-label">🔔 通知音</label>
            <button
              className={`settings-toggle ${settings.notificationSound ? 'on' : 'off'}`}
              onClick={() => updateSetting('notificationSound', !settings.notificationSound)}
            >
              {settings.notificationSound ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* アニメーション速度 */}
          <div className="settings-item">
            <label className="settings-label">🎬 アニメ速度</label>
            <div className="settings-toggle-group">
              <button
                className={`settings-toggle-btn ${settings.animationSpeed === 'normal' ? 'active' : ''}`}
                onClick={() => updateSetting('animationSpeed', 'normal')}
              >
                普通
              </button>
              <button
                className={`settings-toggle-btn ${settings.animationSpeed === 'fast' ? 'active' : ''}`}
                onClick={() => updateSetting('animationSpeed', 'fast')}
              >
                速い
              </button>
            </div>
          </div>

          {/* 背景の暗さ */}
          <div className="settings-item">
            <label className="settings-label">🌗 背景の暗さ</label>
            <div className="settings-slider-row">
              <span className="settings-range-label">明</span>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={settings.bgOverlay}
                onChange={e => updateSetting('bgOverlay', Number(e.target.value))}
                className="settings-slider"
              />
              <span className="settings-range-label">暗</span>
            </div>
          </div>

          {/* フォントサイズ */}
          <div className="settings-item">
            <label className="settings-label">🔤 フォントサイズ</label>
            <div className="settings-toggle-group">
              {(['small', 'medium', 'large'] as const).map(size => (
                <button
                  key={size}
                  className={`settings-toggle-btn ${settings.fontSize === size ? 'active' : ''}`}
                  onClick={() => updateSetting('fontSize', size)}
                >
                  {{ small: '小', medium: '中', large: '大' }[size]}
                </button>
              ))}
            </div>
          </div>

          {/* チャット通知 */}
          <div className="settings-item">
            <label className="settings-label">💬 チャット通知</label>
            <button
              className={`settings-toggle ${settings.chatNotification ? 'on' : 'off'}`}
              onClick={() => updateSetting('chatNotification', !settings.chatNotification)}
            >
              {settings.chatNotification ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn btn-outline" onClick={resetSettings}>
            🔄 デフォルトに戻す
          </button>
          {onLeaveRoom && (
            <>
              {!showLeaveConfirm ? (
                <button className="btn btn-danger-outline" onClick={() => setShowLeaveConfirm(true)}>
                  🚪 退室する
                </button>
              ) : (
                <div className="leave-confirm">
                  <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>ゲームを離れますか？</span>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="btn btn-sm btn-danger" onClick={handleLeave}>はい</button>
                    <button className="btn btn-sm btn-outline" onClick={() => setShowLeaveConfirm(false)}>いいえ</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

