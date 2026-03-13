/**
 * 設定管理 React Context
 * 全設定をlocalStorageに永続化
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

export interface Settings {
  /** BGM音量 (0-100) */
  bgmVolume: number;
  /** SE音量 (0-100) */
  seVolume: number;
  /** 通知音ON/OFF */
  notificationSound: boolean;
  /** カードアニメーション速度: 'normal' | 'fast' */
  animationSpeed: 'normal' | 'fast';
  /** 背景オーバーレイの不透明度 (0-100, 0=明るい, 100=真っ暗) */
  bgOverlay: number;
  /** フォントサイズ: 'small' | 'medium' | 'large' */
  fontSize: 'small' | 'medium' | 'large';
  /** チャット通知ON/OFF */
  chatNotification: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  bgmVolume: 30,
  seVolume: 50,
  notificationSound: true,
  animationSpeed: 'normal',
  bgOverlay: 60,
  fontSize: 'medium',
  chatNotification: true,
};

const STORAGE_KEY = 'cp_settings';

function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

interface SettingsContextType {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // 設定変更時にlocalStorageに保存 + CSS変数更新
  useEffect(() => {
    saveSettings(settings);

    // 背景オーバーレイをCSS変数として適用
    document.documentElement.style.setProperty('--bg-overlay-opacity', String(settings.bgOverlay / 100));

    // フォントサイズをCSS変数として適用
    const fontSizeMap = { small: '14px', medium: '16px', large: '18px' };
    document.documentElement.style.setProperty('--base-font-size', fontSizeMap[settings.fontSize]);
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
