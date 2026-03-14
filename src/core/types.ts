/**
 * はったりポーカー — 型定義
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

// ── プレイヤー ──────────────────────────
export interface Player {
  playerId: string;
  displayName: string;
  hand: Card[];
  tableCards: Card[];
  isEliminated: boolean;
  seatIndex: number;
}

// ── 移動中カード ────────────────────────
export interface PassingCard {
  card: Card;
  fromPlayerId: string;   // 最初に出したプレイヤー
  toPlayerId: string;     // 現在の受け取りプレイヤー
  declaredType: CreatureType; // 現在の宣言
  hasBeenPeeked: boolean; // 受け取り手が確認済みか
  passHistory: string[];  // 通過したプレイヤーID履歴
}

// ── ゲームフェーズ ──────────────────────
export type GamePhase =
  | 'SETUP'                    // ゲーム設定中
  | 'ACTIVE_PLAYER_TURN'       // アクティブプレイヤーがカード選択中
  | 'WAITING_RECEIVER_ACTION'  // 受け取りプレイヤーがA/B選択中
  | 'PEEKING'                  // 受け取りプレイヤーがカード確認中（パス前）
  | 'REVEAL_RESULT'            // チャレンジ結果表示中
  | 'PLAYER_SWITCHING'         // ホットシート: プレイヤー交代画面
  | 'GAME_OVER';               // ゲーム終了

// ── ゲーム状態 ──────────────────────────
export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentPlayerIndex: number;  // 現在のアクティブプレイヤー
  passingCard: PassingCard | null;
  turnCount: number;
  eliminatedPlayers: string[];
  winner: Player | null;
  revealResult: {
    card: Card;
    declaredType: CreatureType;
    wasHonest: boolean;
    loserId: string;  // カードを引き取るプレイヤー
  } | null;
}

// ── アクション ──────────────────────────
export type GameAction =
  | { type: 'START_GAME'; players: { name: string }[] }
  | { type: 'SELECT_CARD'; cardId: string; targetPlayerId: string; declaredType: CreatureType }
  | { type: 'CHALLENGE' }
  | { type: 'PEEK_CARD' }
  | { type: 'PASS_CARD'; targetPlayerId: string; declaredType: CreatureType }
  | { type: 'CONFIRM_RESULT' }
  | { type: 'PLAYER_READY' };  // ホットシート交代完了
