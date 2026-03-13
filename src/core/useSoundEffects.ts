/**
 * サウンドエフェクトフック
 * Web Audio APIを使ってリッチな効果音を生成（外部ファイル不要）
 * 複数オシレーター・和音・ノイズバーストでゲームらしいサウンドを実現
 */

import { useCallback, useRef } from 'react';

type SoundEffect = 'cardPlace' | 'challenge' | 'reveal' | 'eliminate' | 'victory' | 'tick' | 'click'
  | 'eventTrigger' | 'skillUse' | 'turnStart' | 'cardPass' | 'correct' | 'wrong';

export function useSoundEffects(volumeMultiplier: number = 1) {
  const ctxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(true);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  /** 単音を鳴らす（ADSR風エンベロープ付き） */
  const playTone = useCallback((
    frequency: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume: number = 0.15,
    detune: number = 0,
    attackTime: number = 0.01,
    decayTime: number = 0.05,
  ) => {
    if (!enabledRef.current) return;
    const scaledVol = volume * volumeMultiplier;
    if (scaledVol <= 0) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      // ADSR風エンベロープ
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(scaledVol, ctx.currentTime + attackTime);
      gain.gain.linearRampToValueAtTime(scaledVol * 0.7, ctx.currentTime + attackTime + decayTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // AudioContextが利用できない環境では無視
    }
  }, [getCtx, volumeMultiplier]);

  /** 和音を鳴らす（複数音同時） */
  const playChord = useCallback((
    frequencies: number[],
    duration: number,
    type: OscillatorType = 'sine',
    volume: number = 0.08,
    detune: number = 0,
  ) => {
    for (const freq of frequencies) {
      playTone(freq, duration, type, volume, detune, 0.02, 0.08);
    }
  }, [playTone]);

  /** ノイズバースト（スウッシュ/衝撃音用） */
  const playNoise = useCallback((duration: number, volume: number = 0.1) => {
    if (!enabledRef.current) return;
    const scaledVol = volume * volumeMultiplier;
    if (scaledVol <= 0) return;
    try {
      const ctx = getCtx();
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // バンドパスフィルター
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(scaledVol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      // 無視
    }
  }, [getCtx, volumeMultiplier]);

  const play = useCallback((effect: SoundEffect) => {
    if (!enabledRef.current) return;
    switch (effect) {
      case 'cardPlace':
        playTone(400, 0.08, 'triangle', 0.1);
        playTone(300, 0.06, 'sine', 0.06, 0, 0.005);
        setTimeout(() => playTone(250, 0.05, 'triangle', 0.06), 30);
        break;

      case 'challenge':
        // 緊張感のある上昇音 + 重低音の重なり
        playTone(200, 0.3, 'sawtooth', 0.06);
        playTone(250, 0.3, 'sawtooth', 0.04, 5);
        setTimeout(() => {
          playTone(400, 0.25, 'sawtooth', 0.07);
          playTone(500, 0.25, 'sine', 0.05);
        }, 100);
        setTimeout(() => {
          playChord([600, 800, 1000], 0.3, 'sawtooth', 0.05);
          playNoise(0.15, 0.06);
        }, 200);
        break;

      case 'reveal':
        // ドラマチックな揭示音
        playChord([200, 300], 0.15, 'square', 0.05);
        setTimeout(() => {
          playChord([400, 500, 600], 0.25, 'sine', 0.08);
          playNoise(0.1, 0.04);
        }, 200);
        break;

      case 'eliminate':
        // 劇的な下降トレモロ
        playTone(600, 0.15, 'sawtooth', 0.1);
        playTone(580, 0.15, 'sawtooth', 0.06, 10);
        setTimeout(() => {
          playTone(400, 0.2, 'sawtooth', 0.08);
          playTone(380, 0.2, 'sawtooth', 0.05, -10);
        }, 120);
        setTimeout(() => {
          playTone(200, 0.3, 'sawtooth', 0.07);
          playTone(100, 0.4, 'sine', 0.06);
          playNoise(0.2, 0.05);
        }, 250);
        setTimeout(() => {
          playChord([80, 100, 120], 0.5, 'sawtooth', 0.04);
        }, 400);
        break;

      case 'victory':
        // 壮大なファンファーレ（和音アルペジオ）
        playChord([523, 659], 0.3, 'sine', 0.1);
        setTimeout(() => playChord([659, 784], 0.3, 'sine', 0.1), 180);
        setTimeout(() => playChord([784, 988], 0.3, 'sine', 0.1), 360);
        setTimeout(() => {
          playChord([1047, 1319, 1568], 0.6, 'sine', 0.08);
          playChord([523, 784, 1047], 0.6, 'triangle', 0.06);
          playNoise(0.2, 0.04);
        }, 540);
        setTimeout(() => {
          playChord([1047, 1319, 1568, 2093], 0.8, 'sine', 0.06);
        }, 750);
        break;

      case 'tick':
        playTone(900, 0.03, 'sine', 0.06);
        playTone(1200, 0.02, 'sine', 0.03);
        break;

      case 'click':
        playTone(700, 0.04, 'sine', 0.08);
        playTone(1000, 0.03, 'sine', 0.04, 0, 0.002);
        break;

      case 'eventTrigger':
        // 神秘的なパッドサウンド（複数オシレーター重ね）
        playTone(262, 0.4, 'sine', 0.08);
        playTone(264, 0.4, 'sine', 0.04, 5); // 微妙にデチューンで厚み
        setTimeout(() => {
          playTone(330, 0.35, 'sine', 0.08);
          playTone(332, 0.35, 'triangle', 0.04, -5);
        }, 150);
        setTimeout(() => {
          playTone(392, 0.35, 'sine', 0.08);
          playTone(396, 0.35, 'sine', 0.04, 8);
        }, 300);
        setTimeout(() => {
          playChord([523, 659, 784], 0.5, 'sine', 0.06);
          playChord([523, 659, 784], 0.5, 'triangle', 0.03);
        }, 450);
        break;

      case 'skillUse':
        // パワーアップ風（急上昇 + キラキラ）
        playTone(300, 0.08, 'square', 0.07);
        playTone(305, 0.08, 'square', 0.04, 10);
        setTimeout(() => {
          playTone(500, 0.08, 'square', 0.07);
          playNoise(0.05, 0.03);
        }, 60);
        setTimeout(() => {
          playTone(800, 0.1, 'square', 0.08);
          playTone(810, 0.1, 'sine', 0.04);
        }, 120);
        setTimeout(() => {
          playChord([1200, 1500, 1800], 0.25, 'sine', 0.05);
          playNoise(0.08, 0.04);
        }, 180);
        break;

      case 'turnStart':
        // ファンファーレ風チャイム（ベル音色：sine + 倍音）
        playTone(880, 0.2, 'sine', 0.1);
        playTone(1760, 0.15, 'sine', 0.04); // 倍音
        playTone(2640, 0.1, 'sine', 0.02); // 3倍音
        setTimeout(() => {
          playTone(1100, 0.25, 'sine', 0.12);
          playTone(2200, 0.18, 'sine', 0.04);
          playTone(1650, 0.18, 'sine', 0.03);
        }, 120);
        setTimeout(() => {
          playChord([1320, 1650, 2200], 0.15, 'sine', 0.04);
        }, 240);
        break;

      case 'cardPass':
        // スウッシュ音（ノイズバースト + 下降トーン）
        playNoise(0.15, 0.12);
        playTone(600, 0.08, 'triangle', 0.08);
        setTimeout(() => playTone(350, 0.06, 'triangle', 0.05), 40);
        setTimeout(() => playTone(200, 0.05, 'triangle', 0.03), 70);
        break;

      case 'correct':
        // 勝利風の明るい和音3連
        playChord([523, 659], 0.15, 'sine', 0.1);
        setTimeout(() => {
          playChord([659, 784], 0.15, 'sine', 0.1);
        }, 120);
        setTimeout(() => {
          playChord([784, 988, 1175], 0.35, 'sine', 0.08);
          playChord([784, 988, 1175], 0.35, 'triangle', 0.04);
          playNoise(0.08, 0.03);
        }, 240);
        break;

      case 'wrong':
        // ドラマチックな下降和音 + ブザー
        playChord([400, 470], 0.2, 'sawtooth', 0.06);
        playChord([395, 465], 0.2, 'sawtooth', 0.03); // デチューンで不協和
        setTimeout(() => {
          playChord([250, 300], 0.3, 'sawtooth', 0.05);
          playChord([248, 298], 0.3, 'sawtooth', 0.03);
          playTone(100, 0.4, 'square', 0.04);
        }, 180);
        break;
    }
  }, [playTone, playChord, playNoise]);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
  }, []);

  return { play, setEnabled, enabled: enabledRef };
}
