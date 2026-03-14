/**
 * Socket.IO クライアント — カスタムフック
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents, ServerToClientEvents,
  GameStateView, RoomInfo, CreatureType,
} from '../../shared/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ChatMessage {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

interface UseSocketReturn {
  /** 接続状態 */
  connected: boolean;
  /** ルーム情報（ロビー） */
  room: RoomInfo | null;
  /** ゲーム状態（プレイ中） */
  gameState: GameStateView | null;
  /** 自分のプレイヤーID */
  myPlayerId: string | null;
  /** 最新エラー */
  error: string | null;
  /** ルーム作成 */
  createRoom: (playerName: string, maxPlayers?: number, gameMode?: string, eventInterval?: number | string, secretMode?: boolean, turnTimeout?: number, survivalMode?: boolean) => Promise<string>;
  /** ルーム参加 */
  joinRoom: (roomId: string, playerName: string) => Promise<void>;
  /** ゲーム開始（ホストのみ） */
  startGame: () => Promise<void>;
  /** カード選択 */
  selectCard: (cardId: string, targetPlayerId: string, declaredType: CreatureType) => Promise<void>;
  /** チャレンジ（嘘だと思う/本当だと思う） */
  challenge: (believeIsLying: boolean) => Promise<void>;
  /** カード確認（パス前） */
  peekCard: () => Promise<void>;
  /** カードを回す */
  passCard: (targetPlayerId: string, declaredType: CreatureType) => Promise<void>;
  /** 結果確認 */
  confirmResult: () => Promise<void>;
  /** スキル使用 */
  useSkill: (skillType: string, targetPlayerId?: string, tableCardIndex?: number) => Promise<void>;
  /** チェンジスキル: 送り手が新ターゲット選択 */
  changeSelectTarget: (targetPlayerId: string) => Promise<void>;
  /** 救済イベント: 対象が送り先選択 */
  salvationSelectTarget: (targetPlayerId: string) => Promise<void>;
  /** 再戦リクエスト */
  rematch: () => Promise<void>;
  /** チャットメッセージ一覧 */
  chatMessages: ChatMessage[];
  /** チャット送信 */
  sendChat: (message: string) => void;
  /** 観戦者数 */
  spectatorCount: number;
  /** 観戦参加 */
  joinAsSpectator: (roomId: string) => Promise<void>;
  /** ルーム離脱*/
  leaveRoom: () => void;
}

export function useSocket(
  onToast?: (message: string, type: 'info' | 'success' | 'warning') => void,
  onSound?: (effect: string) => void,
): UseSocketReturn {
  const socketRef = useRef<GameSocket | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onSoundRef = useRef(onSound);
  onSoundRef.current = onSound;
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);

  useEffect(() => {
    const socket: GameSocket = io(SERVER_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // 再接続時: 保存されたセッション情報で自動復帰を試みる
      const savedPlayerId = sessionStorage.getItem('cp_playerId');
      const savedRoomId = sessionStorage.getItem('cp_roomId');
      if (savedPlayerId && savedRoomId) {
        socket.emit('reconnect_game', { playerId: savedPlayerId, roomId: savedRoomId }, (res) => {
          if (res.ok && res.playerId) {
            setMyPlayerId(res.playerId);
            console.log(`[再接続成功] ${savedPlayerId} → ${savedRoomId}`);
          } else {
            // 再接続失敗 → セッション情報をクリア
            sessionStorage.removeItem('cp_playerId');
            sessionStorage.removeItem('cp_roomId');
            console.log(`[再接続失敗] ${res.error}`);
          }
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room_update', (r) => setRoom(r));
    socket.on('game_state_update', (s) => setGameState(s));
    socket.on('error', (e) => setError(e.message));
    socket.on('player_disconnected', (data) => {
      console.log(`[切断通知] ${data.playerName} が切断しました`);
      onToastRef.current?.(`⚠️ ${data.playerName} が切断しました`, 'warning');
      onSoundRef.current?.('tick');
    });
    socket.on('player_reconnected', (data) => {
      console.log(`[復帰通知] ${data.playerName} が復帰しました`);
      onToastRef.current?.(`✅ ${data.playerName} が復帰しました`, 'success');
      onSoundRef.current?.('click');
    });
    socket.on('player_eliminated', (data) => {
      onToastRef.current?.(`💀 ${data.playerName} が脱落しました！`, 'warning');
      onSoundRef.current?.('eliminate');
    });
    socket.on('rematch_requested', (data) => {
      onToastRef.current?.(`🔄 ${data.requestedBy} が再戦を希望 (${data.acceptedCount}/${data.totalCount})`, 'info');
      onSoundRef.current?.('click');
    });
    socket.on('rematch_start', () => {
      onToastRef.current?.('🎮 再戦開始！', 'success');
      onSoundRef.current?.('victory');
    });
    socket.on('game_over', () => {
      onSoundRef.current?.('victory');
    });
    socket.on('chat_message', (data) => {
      setChatMessages(prev => [...prev, data]);
    });
    socket.on('spectator_update', (data) => {
      setSpectatorCount(data.spectatorCount);
    });
    socket.on('room_closed', (data) => {
      onToastRef.current?.(`🚪 ${data.reason}`, 'warning');
      setRoom(null);
      setGameState(null);
      setMyPlayerId(null);
      setChatMessages([]);
      sessionStorage.removeItem('cp_playerId');
      sessionStorage.removeItem('cp_roomId');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const getSocket = useCallback((): GameSocket => {
    if (!socketRef.current) throw new Error('Socket not connected');
    return socketRef.current;
  }, []);

  const createRoom = useCallback(async (playerName: string, maxPlayers?: number, gameMode?: string, eventInterval?: number | string, secretMode?: boolean, turnTimeout?: number, survivalMode?: boolean): Promise<string> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('create_room', {
        playerName,
        maxPlayers,
        gameMode: (gameMode as 'normal' | 'event' | 'skill') || 'normal',
        eventInterval: eventInterval as (1 | 2 | 3 | 4 | 5 | 'random') || 3,
        secretMode,
        turnTimeout,
        survivalMode,
      }, (res) => {
        if (res.ok && res.roomId && res.playerId) {
          setMyPlayerId(res.playerId);
          sessionStorage.setItem('cp_playerId', res.playerId);
          sessionStorage.setItem('cp_roomId', res.roomId);
          resolve(res.roomId);
        } else {
          const msg = res.error || 'ルーム作成失敗';
          setError(msg);
          reject(new Error(msg));
        }
      });
    });
  }, [getSocket]);

  const joinRoom = useCallback(async (roomId: string, playerName: string): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('join_room', { roomId, playerName }, (res) => {
        if (res.ok && res.playerId) {
          setMyPlayerId(res.playerId);
          sessionStorage.setItem('cp_playerId', res.playerId);
          sessionStorage.setItem('cp_roomId', roomId.toUpperCase());
          resolve();
        } else {
          const msg = res.error || 'ルーム参加失敗';
          setError(msg);
          reject(new Error(msg));
        }
      });
    });
  }, [getSocket]);

  const startGame = useCallback(async (): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('start_game', (res) => {
        if (res.ok) resolve();
        else {
          const msg = res.error || 'ゲーム開始失敗';
          setError(msg);
          reject(new Error(msg));
        }
      });
    });
  }, [getSocket]);

  const selectCard = useCallback(async (cardId: string, targetPlayerId: string, declaredType: CreatureType): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('select_card', { cardId, targetPlayerId, declaredType }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const challenge = useCallback(async (believeIsLying: boolean): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('challenge', { believeIsLying }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const peekCard = useCallback(async (): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('peek_card', (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const passCard = useCallback(async (targetPlayerId: string, declaredType: CreatureType): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('pass_card', { targetPlayerId, declaredType }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const confirmResult = useCallback(async (): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('confirm_result', (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const rematch = useCallback(async (): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('rematch', (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const useSkill = useCallback(async (skillType: string, targetPlayerId?: string, tableCardIndex?: number): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('use_skill', { skillType: skillType as any, targetPlayerId, tableCardIndex }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const changeSelectTarget = useCallback(async (targetPlayerId: string): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('change_select_target', { targetPlayerId }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const salvationSelectTarget = useCallback(async (targetPlayerId: string): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('salvation_select_target', { targetPlayerId }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  const leaveRoom = useCallback(() => {
    const socket = getSocket();
    socket.emit('leave_room');
    setRoom(null);
    setGameState(null);
    setMyPlayerId(null);
    sessionStorage.removeItem('cp_playerId');
    sessionStorage.removeItem('cp_roomId');
    setChatMessages([]);
  }, [getSocket]);

  const sendChat = useCallback((message: string) => {
    const socket = getSocket();
    socket.emit('send_chat', { message }, () => {});
  }, [getSocket]);

  const joinAsSpectator = useCallback(async (roomId: string): Promise<void> => {
    const socket = getSocket();
    return new Promise((resolve, reject) => {
      socket.emit('join_as_spectator', { roomId }, (res) => {
        if (res.ok) resolve();
        else {
          setError(res.error || '操作失敗');
          reject(new Error(res.error));
        }
      });
    });
  }, [getSocket]);

  return {
    connected, room, gameState, myPlayerId, error,
    createRoom, joinRoom, startGame,
    selectCard, challenge, peekCard, passCard, confirmResult,
    useSkill, changeSelectTarget, salvationSelectTarget,
    rematch, chatMessages, sendChat, spectatorCount, joinAsSpectator, leaveRoom,
  };
}
