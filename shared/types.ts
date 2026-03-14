/**
 * はったりポーカー — 共有型定義
 * サーバー・クライアント両方で使用する型
 */

// ── 生き物の種類 ──────────────────────────
export const CREATURE_TYPES = [
  'COCKROACH', 'RAT', 'FLY', 'TOAD',
  'SCORPION', 'BAT', 'STINKBUG', 'SPIDER',
] as const;

export type CreatureType = typeof CREATURE_TYPES[number];

export const CREATURE_INFO: Record<CreatureType, { name: string; emoji: string; color: string }> = {
  COCKROACH: { name: 'ゴキブリ', emoji: '🪳', color: '#6B3A2A' },
  RAT:       { name: 'ネズミ',   emoji: '🐀', color: '#7A7A7A' },
  FLY:       { name: 'ハエ',     emoji: '🪰', color: '#4A7C3F' },
  TOAD:      { name: 'ヒキガエル', emoji: '🐸', color: '#5A8A3E' },
  SCORPION:  { name: 'サソリ',   emoji: '🦂', color: '#C4A000' },
  BAT:       { name: 'コウモリ', emoji: '🦇', color: '#3A3A6A' },
  STINKBUG:  { name: 'カメムシ', emoji: '🪲', color: '#8B6914' },
  SPIDER:    { name: 'クモ',     emoji: '🕷️', color: '#8B1A1A' },
};

export const ELIMINATION_COUNT = 4; // 同種4枚で敗北
export const CARDS_PER_CREATURE = 8; // 各8枚

// ── カード ──────────────────────────────
export interface Card {
  cardId: string;
  creatureType: CreatureType;
}

// ── プレイヤー（サーバー側の完全版） ──────────────────────────
export interface Player {
  playerId: string;
  displayName: string;
  hand: Card[];
  tableCards: Card[];
  isEliminated: boolean;
  seatIndex: number;
  /** スキルポイント */
  sp: number;
}

// ── プレイヤービュー（クライアントに送信される版） ──────────
export interface PlayerView {
  playerId: string;
  displayName: string;
  handCount: number;      // 他プレイヤーには枚数のみ
  hand?: Card[];          // 自分自身の場合のみ含まれる
  tableCards: Card[];
  isEliminated: boolean;
  seatIndex: number;
  /** スキルポイント */
  sp: number;
}

// ── 移動中カード ────────────────────────
export interface PassingCard {
  card: Card;
  fromPlayerId: string;
  toPlayerId: string;
  declaredType: CreatureType;
  hasBeenPeeked: boolean;
  passHistory: string[];
}

// ── 移動中カードビュー（クライアント用） ─────────
export interface PassingCardView {
  fromPlayerId: string;
  toPlayerId: string;
  declaredType: CreatureType;
  card?: Card;            // 受け取り手がPEEK済み or REVEAL時のみ
  passableTargetIds: string[];  // パス可能な相手のID一覧
}

// ── ゲームフェーズ ──────────────────────
export type GamePhase =
  | 'SETUP'
  | 'ACTIVE_PLAYER_TURN'
  | 'WAITING_RECEIVER_ACTION'
  | 'PEEKING'
  | 'REVEAL_RESULT'
  | 'PLAYER_SWITCHING'       // ホットシート用（オンラインでは使わない）
  | 'GAME_OVER';

// ── ゲーム状態（サーバー側の完全版） ──────────────────────────
export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentPlayerIndex: number;
  passingCard: PassingCard | null;
  turnCount: number;
  eliminatedPlayers: string[];
  winner: Player | null;
  revealResult: {
    card: Card;
    declaredType: CreatureType;
    wasHonest: boolean;
    challengerBelievesLying: boolean;
    challengerCorrect: boolean;
    loserId: string;
  } | null;
}

// ── ゲームモード ──────────────────────────
export type GameMode = 'normal' | 'event' | 'skill';

// ── プレイヤー統計データ ──────────────────────────
export interface PlayerStats {
  bluffSuccess: number; // 嘘の宣言で騙した
  bluffFail: number; // 嘘がバレた
  truthSuccess: number; // 正直宣言でチャレンジ誘い成功
  detectSuccess: number; // 嘘を見抜いた
  detectFail: number; // 本当を嘘と判断
  passCount: number; // 確認して回した回数
  challengeCount: number; // チャレンジ合計
  immediateChallengeSuccess: number; // 回さずに即チャレンジ成功
  immediateChallengeFail: number; // 回さずに即チャレンジ失敗
  lastReceiverCount: number; // 最後の手番になった回数
  declarationCounts: Record<CreatureType, number>; // 宣言種類別
  cardsReceived: number; // 受け取ったカード枚数
}

// ── 称号 ──────────────────────────
export interface Title {
  emoji: string;
  name: string;
  description: string;
}

// ── イベントカード ──────────────────────────
export type EventType = 'SHUFFLE' | 'LEAK' | 'BARRIER' | 'ROULETTE' | 'DOUBLE_RISK' | 'LOCK' | 'SALVATION';

/** イベント間隔: 1-5ターンごと or 'random' (20%確率) */
export type EventInterval = 1 | 2 | 3 | 4 | 5 | 'random';

export interface ActiveEvent {
  type: EventType;
  emoji: string;
  name: string;
  description: string;
  /** ロックイベント時の強制宣言タイプ */
  lockedType?: CreatureType;
  /** リークイベント時の公開カード情報 */
  leakedCards?: { playerId: string; playerName: string; card: Card }[];
  /** 救済イベント時: 対象プレイヤーID一覧 */
  salvationTargets?: string[];
}

// ── スキルシステム ──────────────────────────────
export type SkillType = 'ATTACK' | 'CHANGE' | 'SHIELD' | 'HEAL';

// -- リプレイログ
export type ReplayAction = 'GAME_START' | 'DECLARE' | 'CHALLENGE' | 'RESULT' | 'PASS' | 'PEEK'
  | 'ELIMINATE' | 'EVENT' | 'SKILL' | 'SALVATION' | 'GAME_OVER';

export interface ReplayEntry {
  turn: number;
  action: ReplayAction;
  playerName: string;
  detail: string;
  emoji: string;
  timestamp: number;
}

// ── ゲーム状態ビュー（クライアントに送信される版） ──────────
export interface GameStateView {
  phase: GamePhase;
  players: PlayerView[];
  currentPlayerIndex: number;
  passingCard: PassingCardView | null;
  turnCount: number;
  eliminatedPlayers: string[];
  winner: PlayerView | null;
  myPlayerId: string;
  gameMode: GameMode;
  turnDeadline: number | null;
  /** ゲーム終了時、プレイヤー別の称号リスト */
  titles: Record<string, Title[]> | null;
  /** 発動中のイベント */
  activeEvent: ActiveEvent | null;
  /** バリア効果中 */
  barrierActive: boolean;
  /** ダブルリスク効果中 */
  doubleRiskActive: boolean;
  /** ロック中の宣言制限 */
  lockedDeclareType: CreatureType | null;
  /** ルーレット中の強制ターゲット */
  rouletteTarget: string | null;
  /** アタックスキル発動中のプレイヤーID */
  attackActiveBy: string | null;
  /** シールドスキル発動中 */
  shieldActive: boolean;
  /** チェンジスキル待ち: 相手がターゲットを再選択中 */
  changePending: boolean;
  /** 救済イベント: 対象プレイヤーが送り先を選択中 */
  salvationPending: { playerId: string; cardCount: number }[] | null;
  revealResult: {
    card: Card;
    declaredType: CreatureType;
    wasHonest: boolean;
    challengerBelievesLying: boolean;
    challengerCorrect: boolean;
    loserId: string;
  } | null;
  /** リプレイログ（ゲーム終了時に含まれる） */
  replayLog: ReplayEntry[] | null;
  /** BGM開始インデックス（0-2）全員同期用 */
  bgmStartIndex: number;
}

// ── アクション（ローカル用） ──────────────────────────
export type GameAction =
  | { type: 'START_GAME'; players: { name: string }[] }
  | { type: 'SELECT_CARD'; cardId: string; targetPlayerId: string; declaredType: CreatureType }
  | { type: 'CHALLENGE' }
  | { type: 'PEEK_CARD' }
  | { type: 'PASS_CARD'; targetPlayerId: string; declaredType: CreatureType }
  | { type: 'CONFIRM_RESULT' }
  | { type: 'PLAYER_READY' };

// ── ルーム ──────────────────────────
export interface RoomInfo {
  roomId: string;
  hostPlayerId: string;
  players: { playerId: string; displayName: string }[];
  maxPlayers: number;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED';
  gameMode: GameMode;
  eventInterval: EventInterval;
  secretMode?: boolean;
  survivalMode?: boolean;
}

// ── Socket.IO イベント型定義 ──────────────────────────

// クライアント → サーバー
export interface ClientToServerEvents {
  create_room: (data: { playerName: string; maxPlayers?: number; gameMode?: GameMode; eventInterval?: EventInterval; secretMode?: boolean; turnTimeout?: number; survivalMode?: boolean }, callback: (res: { ok: boolean; roomId?: string; playerId?: string; error?: string }) => void) => void;
  join_room: (data: { roomId: string; playerName: string }, callback: (res: { ok: boolean; playerId?: string; error?: string }) => void) => void;
  start_game: (callback: (res: { ok: boolean; error?: string }) => void) => void;
  select_card: (data: { cardId: string; targetPlayerId: string; declaredType: CreatureType }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  challenge: (data: { believeIsLying: boolean }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  peek_card: (callback: (res: { ok: boolean; error?: string }) => void) => void;
  pass_card: (data: { targetPlayerId: string; declaredType: CreatureType }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  confirm_result: (callback: (res: { ok: boolean; error?: string }) => void) => void;
  reconnect_game: (data: { playerId: string; roomId: string }, callback: (res: { ok: boolean; roomId?: string; playerId?: string; error?: string }) => void) => void;
  rematch: (callback: (res: { ok: boolean; error?: string }) => void) => void;
  send_chat: (data: { message: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  join_as_spectator: (data: { roomId: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  use_skill: (data: { skillType: SkillType; targetPlayerId?: string; tableCardIndex?: number }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  change_select_target: (data: { targetPlayerId: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  salvation_select_target: (data: { targetPlayerId: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  leave_room: () => void;
}

// サーバー → クライアント
export interface ServerToClientEvents {
  room_update: (room: RoomInfo) => void;
  game_state_update: (state: GameStateView) => void;
  player_eliminated: (data: { playerId: string; playerName: string; creatureType: CreatureType }) => void;
  game_over: (data: { winnerName: string; winnerId: string }) => void;
  player_disconnected: (data: { playerId: string; playerName: string }) => void;
  player_reconnected: (data: { playerId: string; playerName: string }) => void;
  rematch_requested: (data: { requestedBy: string; acceptedCount: number; totalCount: number }) => void;
  rematch_start: () => void;
  chat_message: (data: { playerId: string; playerName: string; message: string; timestamp: number }) => void;
  spectator_update: (data: { spectatorCount: number }) => void;
  error: (data: { code: string; message: string }) => void;
  room_closed: (data: { reason: string }) => void;
}
