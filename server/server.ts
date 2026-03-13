/**
 * はったりポーカー — ゲームサーバー
 * Express + Socket.IO
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import type {
  Card, Player, GameState, PassingCard, CreatureType,
  GameStateView, PlayerView, PassingCardView, PlayerStats, Title, GameMode,
  ActiveEvent, EventType, EventInterval, SkillType, ReplayEntry,
  RoomInfo, ClientToServerEvents, ServerToClientEvents,
} from '../shared/types.js';
import {
  CREATURE_TYPES, CARDS_PER_CREATURE, ELIMINATION_COUNT, CREATURE_INFO,
} from '../shared/types.js';

// ── ルーム管理 ──────────────────────────
interface Room {
  roomId: string;
  hostSocketId: string;
  hostPlayerId: string;
  maxPlayers: number;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED';
  /** socketId → { playerId, displayName } */
  members: Map<string, { playerId: string; displayName: string }>;
  /** 切断中のプレイヤー: playerId → { displayName, disconnectTimer } */
  disconnectedPlayers: Map<string, { displayName: string; timer: ReturnType<typeof setTimeout> }>;
  /** ターンタイマー */
  turnTimer: ReturnType<typeof setTimeout> | null;
  turnDeadline: number | null;
  /** 再戦受諎inのplayerIdSet */
  rematchAccepted: Set<string>;
  /** 観戦者のSocket ID Set */
  spectators: Set<string>;
  /** ゲームモード */
  gameMode: GameMode;
  /** プレイヤー統計 (playerId→PlayerStats) */
  playerStats: Map<string, PlayerStats>;
  /** イベント間隔設定 */
  eventInterval: EventInterval;
  /** 発動中イベント */
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
  /** チェンジスキル待ち */
  changePending: boolean;
  /** 救済イベント: 対象プレイヤーが送り先を選択中 */
  salvationPending: { playerId: string; cardCount: number }[] | null;
  /** リプレイログ */
  replayLog: ReplayEntry[];
  gameState: GameState | null;
  /** たぬきモード（ホストが発動） */
  secretMode: boolean;
  /** ターンタイムアウト（ミリ秒） */
  turnTimeoutMs: number;
}

const rooms = new Map<string, Room>();

/** リプレイログにエントリを追加 */
function addReplayLog(room: Room, action: ReplayEntry['action'], playerName: string, detail: string, emoji: string) {
  room.replayLog.push({
    turn: room.gameState?.turnCount ?? 0,
    action,
    playerName,
    detail,
    emoji,
    timestamp: Date.now(),
  });
}

/** socketId -> roomId */
const socketToRoom = new Map<string, string>();
/** playerId → roomId (再接続用) */
const playerIdToRoom = new Map<string, string>();

const DISCONNECT_TIMEOUT_MS = 30_000; // 切断後の猶予期間 30秒
const DEFAULT_TURN_TIMEOUT_MS = 180_000;  // デフォルト: 180秒

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ── 名前キーワード検知（たぬき変換） ──────────────────────────
const TANUKI_KEYWORDS = ['ぽろあーく', 'ポロアーク', 'poro', 'polo', '狐', 'キツネ', 'じゃい', 'じゃない'];

function applyTanukiName(displayName: string): string {
  const lower = displayName.toLowerCase();
  if (TANUKI_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
    return 'たぬき';
  }
  return displayName;
}



// ── イベントカード関連 ──────────────────────────
const EVENT_TYPES: EventType[] = ['SHUFFLE', 'LEAK', 'BARRIER', 'ROULETTE', 'DOUBLE_RISK', 'LOCK', 'SALVATION'];

const EVENT_INFO: Record<EventType, { emoji: string; name: string; description: string }> = {
  SHUFFLE: { emoji: '🔄', name: 'シャッフル', description: '全員の手札をまとめて再配布！' },
  LEAK: { emoji: '👀', name: 'リーク', description: '各プレイヤーの手札1枚がランダムに公開！' },
  BARRIER: { emoji: '🛡️', name: 'バリア', description: '次のチャレンジ失敗でもカードを受け取らない！' },
  ROULETTE: { emoji: '🎲', name: 'ルーレット', description: 'カードを渡す相手がランダムに決定！' },
  DOUBLE_RISK: { emoji: '⚡', name: 'ダブルリスク', description: 'チャレンジ失敗で追加ペナルティ！' },
  LOCK: { emoji: '🔒', name: 'ロック', description: 'このターンは特定のカードしか宣言できない！' },
  SALVATION: { emoji: '🙏', name: '救済', description: '場のカード最多プレイヤーが救済される！' },
};

function generateRandomEvent(): EventType {
  return EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
}

function shouldTriggerEvent(room: Room, turnCount: number): boolean {
  if (room.gameMode !== 'event') return false;
  if (room.eventInterval === 'random') {
    return Math.random() < 0.2; // 20%
  }
  return turnCount > 1 && (turnCount - 1) % room.eventInterval === 0;
}

function triggerEvent(room: Room): ActiveEvent | null {
  if (!room.gameState) return null;
  const state = room.gameState;
  const eventType = generateRandomEvent();
  const info = EVENT_INFO[eventType];
  const event: ActiveEvent = { type: eventType, ...info };

  // イベント効果の即時適用
  switch (eventType) {
    case 'SHUFFLE': {
      // 全手札をまとめて再配布
      const activePlayers = state.players.filter(p => !p.isEliminated);
      const allCards: Card[] = [];
      for (const p of activePlayers) allCards.push(...p.hand);
      const shuffled = shuffleDeck(allCards);
      const perPlayer = Math.floor(shuffled.length / activePlayers.length);
      let idx = 0;
      for (const p of activePlayers) {
        p.hand = shuffled.slice(idx, idx + perPlayer);
        idx += perPlayer;
      }
      // 余りを最初のプレイヤーに
      if (idx < shuffled.length) activePlayers[0].hand.push(...shuffled.slice(idx));
      break;
    }
    case 'LEAK': {
      // 各プレイヤー手札1枚をランダム公開
      const leaked: { playerId: string; playerName: string; card: Card }[] = [];
      for (const p of state.players) {
        if (!p.isEliminated && p.hand.length > 0) {
          const randIdx = Math.floor(Math.random() * p.hand.length);
          leaked.push({ playerId: p.playerId, playerName: p.displayName, card: p.hand[randIdx] });
        }
      }
      event.leakedCards = leaked;
      break;
    }
    case 'BARRIER': {
      room.barrierActive = true;
      break;
    }
    case 'ROULETTE': {
      const currentPlayer = state.players[state.currentPlayerIndex];
      const targets = state.players.filter(p => !p.isEliminated && p.playerId !== currentPlayer.playerId);
      if (targets.length > 0) {
        const randomTarget = targets[Math.floor(Math.random() * targets.length)];
        room.rouletteTarget = randomTarget.playerId;
      }
      break;
    }
    case 'DOUBLE_RISK': {
      room.doubleRiskActive = true;
      break;
    }
    case 'LOCK': {
      const lockedType = CREATURE_TYPES[Math.floor(Math.random() * CREATURE_TYPES.length)];
      room.lockedDeclareType = lockedType;
      event.lockedType = lockedType;
      break;
    }
    case 'SALVATION': {
      const activePlayers = state.players.filter(p => !p.isEliminated);
      const maxCards = Math.max(...activePlayers.map(p => p.tableCards.length));
      if (maxCards === 0) {
        event.description = '場にカードのあるプレイヤーがいないため不発！';
        event.salvationTargets = [];
      } else {
        const richPlayers = activePlayers.filter(p => p.tableCards.length === maxCards);
        // 即座に移動せず、対象プレイヤーに送り先選択を委ねる
        const pending = richPlayers.map(p => ({ playerId: p.playerId, cardCount: 1 }));
        room.salvationPending = pending;
        event.salvationTargets = richPlayers.map(p => p.playerId);
        event.description = `場カード最多のプレイヤーがカードの送り先を選びます！`;
      }
      break;
    }
  }

  room.activeEvent = event;
  // リプレイログ: イベント発動
  addReplayLog(room, 'EVENT', '', info.emoji + ' ' + info.name + ' — ' + info.description, info.emoji);
  return event;
}

function clearEventEffects(room: Room) {
  room.activeEvent = null;
  room.barrierActive = false;
  room.doubleRiskActive = false;
  room.lockedDeclareType = null;
  room.rouletteTarget = null;
  room.salvationPending = null;
}

function createEmptyStats(): PlayerStats {
  const declarationCounts = {} as Record<CreatureType, number>;
  for (const type of CREATURE_TYPES) declarationCounts[type] = 0;
  return {
    bluffSuccess: 0, bluffFail: 0, truthSuccess: 0,
    detectSuccess: 0, detectFail: 0,
    passCount: 0, challengeCount: 0,
    immediateChallengeSuccess: 0, immediateChallengeFail: 0,
    lastReceiverCount: 0, declarationCounts, cardsReceived: 0,
  };
}

function calculateTitles(room: Room): Record<string, Title[]> {
  const result: Record<string, Title[]> = {};
  const allStats = Array.from(room.playerStats.entries());
  if (allStats.length === 0) return result;

  // 全プレイヤーのIDをresultに初期化
  for (const [playerId] of allStats) {
    result[playerId] = [];
  }

  // ── ヘルパー: スコア最大の1人のみに称号を付与（同率は付与しない） ──
  const awardUnique = (
    scoreFn: (stats: PlayerStats, playerId: string) => number,
    emoji: string,
    name: string,
    description: string,
  ) => {
    let maxScore = 0;
    let maxId: string | null = null;
    let tied = false;
    for (const [playerId, stats] of allStats) {
      const score = scoreFn(stats, playerId);
      if (score > maxScore) {
        maxScore = score;
        maxId = playerId;
        tied = false;
      } else if (score === maxScore && score > 0) {
        tied = true;
      }
    }
    if (maxId && maxScore > 0 && !tied) {
      result[maxId].push({ emoji, name, description });
    }
  };

  // 🐔 チキン: チャレンジ回数が最も少ない（0が最優先）
  awardUnique(
    (stats) => stats.challengeCount === 0 ? 1000 : 0,
    '🐔', 'チキン', '一度もチャレンジしなかった'
  );

  // 😰 いつも最後: パスできない最後の手番に最も多くなった
  awardUnique(
    (stats) => stats.lastReceiverCount,
    '😰', 'いつも最後', 'パスできない最後の手番に最も多くなった'
  );

  // 🔥 勝負師: 即チャレンジ成功が最も多い
  awardUnique(
    (stats) => stats.immediateChallengeSuccess,
    '🔥', '勝負師', '即チャレンジ的中が最も多い'
  );

  // 💥 無謀: 即チャレンジ失敗が最も多い
  awardUnique(
    (stats) => stats.immediateChallengeFail,
    '💥', '無謀', '即チャレンジ失敗が最も多い'
  );

  // 🎯 一撃必殺: チャレンジ無敗（最もチャレンジ成功した人）
  awardUnique(
    (stats) => (stats.challengeCount > 0 && stats.detectFail === 0 && stats.detectSuccess > 0) ? stats.detectSuccess : 0,
    '🎯', '一撃必殺', 'チャレンジ無敗'
  );

  // 🎭 ブラフマスター: 嘘で騙した回数最多
  awardUnique(
    (stats) => stats.bluffSuccess,
    '🎭', 'ブラフマスター', '嘘の宣言で騙した回数最多'
  );

  // 🔍 名探偵: 嘘を見抜いた回数最多
  awardUnique(
    (stats) => stats.detectSuccess,
    '🔍', '名探偵', '嘘を見抜いた回数最多'
  );

  // 😇 正直者: 正直宣言でチャレンジを誘った回数最多
  awardUnique(
    (stats) => stats.truthSuccess,
    '😇', '正直者', '正直宣言でチャレンジを誘った回数最多'
  );

  // 🤥 嘘つき王: 嘘がバレた回数最多
  awardUnique(
    (stats) => stats.bluffFail,
    '🤥', '嘘つき王', '嘘がバレた回数最多'
  );

  // 🔄 たらい回し職人: 「確認して回す」回数最多
  awardUnique(
    (stats) => stats.passCount,
    '🔄', 'たらい回し職人', '「確認して回す」回数最多'
  );

  // 🪳 〇〇好き: 特定の生物を最も多く宣言
  {
    let maxCount = 0;
    let maxId: string | null = null;
    let maxCreature = '';
    let tied = false;
    for (const [playerId, stats] of allStats) {
      const maxDecl = Object.entries(stats.declarationCounts)
        .sort((a, b) => b[1] - a[1])[0];
      if (maxDecl && maxDecl[1] >= 3) {
        if (maxDecl[1] > maxCount) {
          maxCount = maxDecl[1];
          maxId = playerId;
          maxCreature = maxDecl[0];
          tied = false;
        } else if (maxDecl[1] === maxCount) {
          tied = true;
        }
      }
    }
    if (maxId && !tied) {
      result[maxId].push({ emoji: '🪳', name: `${maxCreature}好き`, description: `${maxCreature}を${maxCount}回宣言` });
    }
  }

  // 🏆 完全勝利: 勝者かつカードを1枚も受け取っていない
  if (room.gameState?.winner) {
    const winnerId = room.gameState.winner.playerId;
    const winnerStats = room.playerStats.get(winnerId);
    if (winnerStats && winnerStats.cardsReceived === 0) {
      result[winnerId].push({ emoji: '🏆', name: '完全勝利', description: 'カードを1枚も受け取らずに勝利' });
    }
  }

  return result;
}

// ── デッキ & ゲームロジック ──────────────────────────
function createDeck(): Card[] {
  const deck: Card[] = [];
  let idCounter = 0;
  for (const type of CREATURE_TYPES) {
    for (let i = 0; i < CARDS_PER_CREATURE; i++) {
      deck.push({
        cardId: `${type.toLowerCase()}_${String(idCounter++).padStart(2, '0')}`,
        creatureType: type,
      });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(deck: Card[], playerCount: number): { hands: Card[][]; remaining: Card[] } {
  const cardsPerPlayer = Math.floor(deck.length / playerCount);
  const hands: Card[][] = [];
  const dealt = [...deck];
  for (let i = 0; i < playerCount; i++) {
    hands.push(dealt.splice(0, cardsPerPlayer));
  }
  return { hands, remaining: dealt };
}

function checkElimination(player: Player): CreatureType | null {
  const counts: Partial<Record<CreatureType, number>> = {};
  for (const card of player.tableCards) {
    counts[card.creatureType] = (counts[card.creatureType] || 0) + 1;
    if (counts[card.creatureType]! >= ELIMINATION_COUNT) return card.creatureType;
  }
  return null;
}

function findNextActivePlayer(players: Player[], currentIndex: number): number {
  const count = players.length;
  let next = (currentIndex + 1) % count;
  let attempts = 0;
  while (attempts < count) {
    if (!players[next].isEliminated && players[next].hand.length > 0) return next;
    next = (next + 1) % count;
    attempts++;
  }
  // 手札なしでも生存していればOK
  next = (currentIndex + 1) % count;
  attempts = 0;
  while (attempts < count) {
    if (!players[next].isEliminated) return next;
    next = (next + 1) % count;
    attempts++;
  }
  return currentIndex;
}

function getMaxSameTypeCount(player: Player): number {
  const counts: Partial<Record<CreatureType, number>> = {};
  for (const card of player.tableCards) {
    counts[card.creatureType] = (counts[card.creatureType] || 0) + 1;
  }
  return Math.max(0, ...Object.values(counts).map(v => v || 0));
}

function checkGameOver(players: Player[]): Player | null {
  const alive = players.filter(p => !p.isEliminated);
  // はったりポーカー: 1人が脱落した時点でゲーム終了
  if (alive.length < players.length) {
    // 勝者 = 生存者の中で場のカードが最も少ないプレイヤー
    const sorted = [...alive].sort((a, b) => {
      if (a.tableCards.length !== b.tableCards.length) return a.tableCards.length - b.tableCards.length;
      return getMaxSameTypeCount(a) - getMaxSameTypeCount(b);
    });
    return sorted[0];
  }
  // 全員の手札がなくなった場合もゲーム終了
  if (alive.every(p => p.hand.length === 0)) {
    const sorted = [...alive].sort((a, b) => {
      if (a.tableCards.length !== b.tableCards.length) return a.tableCards.length - b.tableCards.length;
      return getMaxSameTypeCount(a) - getMaxSameTypeCount(b);
    });
    return sorted[0];
  }
  return null;
}

function getPassableTargets(state: GameState): Player[] {
  if (!state.passingCard) return [];
  const currentPlayerId = state.players[state.currentPlayerIndex].playerId;
  return state.players.filter(p =>
    !p.isEliminated &&
    p.playerId !== currentPlayerId &&
    p.playerId !== state.passingCard!.fromPlayerId &&
    !state.passingCard!.passHistory.includes(p.playerId)
  );
}

function getTargetPlayers(state: GameState): Player[] {
  const currentPlayerId = state.players[state.currentPlayerIndex].playerId;
  return state.players.filter(p => !p.isEliminated && p.playerId !== currentPlayerId);
}

// ── 情報秘匿フィルタ ──────────────────────────
function filterStateForPlayer(state: GameState, playerId: string): GameStateView {
  const players: PlayerView[] = state.players.map(p => {
    const isMe = p.playerId === playerId;
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      handCount: p.hand.length,
      hand: isMe ? p.hand : undefined,
      tableCards: p.tableCards,
      isEliminated: p.isEliminated,
      seatIndex: p.seatIndex,
      sp: p.sp,
    };
  });

  let passingCard: PassingCardView | null = null;
  if (state.passingCard) {
    const isReceiver = state.passingCard.toPlayerId === playerId;
    const isPeeking = state.phase === 'PEEKING' && isReceiver;
    const isRevealing = state.phase === 'REVEAL_RESULT';
    const passable = getPassableTargets(state);
    passingCard = {
      fromPlayerId: state.passingCard.fromPlayerId,
      toPlayerId: state.passingCard.toPlayerId,
      declaredType: state.passingCard.declaredType,
      card: (isPeeking || isRevealing) ? state.passingCard.card : undefined,
      passableTargetIds: passable.map(p => p.playerId),
    };
  }

  let winnerView: PlayerView | null = null;
  if (state.winner) {
    winnerView = {
      playerId: state.winner.playerId,
      displayName: state.winner.displayName,
      handCount: state.winner.hand.length,
      tableCards: state.winner.tableCards,
      isEliminated: state.winner.isEliminated,
      seatIndex: state.winner.seatIndex,
      sp: state.winner.sp,
    };
  }

  return {
    phase: state.phase,
    players,
    currentPlayerIndex: state.currentPlayerIndex,
    passingCard,
    turnCount: state.turnCount,
    eliminatedPlayers: state.eliminatedPlayers,
    winner: winnerView,
    myPlayerId: playerId,
    gameMode: 'normal',
    turnDeadline: null,
    titles: null,
    activeEvent: null,
    barrierActive: false,
    doubleRiskActive: false,
    lockedDeclareType: null,
    rouletteTarget: null,
    attackActiveBy: null,
    shieldActive: false,
    changePending: false,
    salvationPending: null,
    revealResult: state.revealResult,
    replayLog: null,
  };
}

// ── サーバー起動 ──────────────────────────
const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// ── フロントエンド配信（本番用） ──────────────────────────
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

// distフォルダの探索: exe化時はprocess.execPathの隣、開発時は__dirname/../dist
import fs from 'fs';
const distCandidates = [
  path.join(path.dirname(process.execPath), 'dist'),  // exe化時
  path.join(__dirname2, '..', 'dist'),                  // 開発時
  path.join(process.cwd(), 'dist'),                     // カレントディレクトリ
];
const distPath = distCandidates.find(p => fs.existsSync(p)) || distCandidates[0];

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPAフォールバック: 静的ファイル以外はindex.htmlを返す
  app.use((_req, res, next) => {
    const indexFile = path.join(distPath, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      next();
    }
  });
  console.log(`[配信] フロントエンド: ${distPath}`);
}

// ── ルーム情報をブロードキャスト ──────────────────────────
function broadcastRoomUpdate(room: Room) {
  const info: RoomInfo = {
    roomId: room.roomId,
    hostPlayerId: room.hostPlayerId,
    players: Array.from(room.members.values()).concat(
      Array.from(room.disconnectedPlayers.entries()).map(([pid, dp]) => ({ playerId: pid, displayName: `${dp.displayName} (切断中)` }))
    ),
    maxPlayers: room.maxPlayers,
    status: room.status,
    gameMode: room.gameMode,
    eventInterval: room.eventInterval,
    secretMode: room.secretMode,
  };
  io.to(room.roomId).emit('room_update', info);
}

// ── ゲーム状態をプレイヤー別に送信 ──────────────────────────
function broadcastGameState(room: Room) {
  if (!room.gameState) return;
  const titles = room.gameState.phase === 'GAME_OVER' ? calculateTitles(room) : null;
  for (const [socketId, member] of room.members) {
    const view = filterStateForPlayer(room.gameState, member.playerId);
    view.turnDeadline = room.turnDeadline;
    view.gameMode = room.gameMode;
    view.titles = titles;
    view.activeEvent = room.activeEvent;
    view.barrierActive = room.barrierActive;
    view.doubleRiskActive = room.doubleRiskActive;
    view.lockedDeclareType = room.lockedDeclareType;
    view.rouletteTarget = room.rouletteTarget;
    view.attackActiveBy = room.attackActiveBy;
    view.shieldActive = room.shieldActive;
    view.changePending = room.changePending;
    view.salvationPending = room.salvationPending;
    // リプレイログを常時送信（プレイログ表示用）
    view.replayLog = room.replayLog;
    io.to(socketId).emit('game_state_update', view);
  }
  // 観戦者向け
  if (room.spectators.size > 0) {
    const spectatorView = filterStateForPlayer(room.gameState, '__spectator__');
    spectatorView.turnDeadline = room.turnDeadline;
    spectatorView.gameMode = room.gameMode;
    spectatorView.titles = titles;
    spectatorView.activeEvent = room.activeEvent;
    spectatorView.barrierActive = room.barrierActive;
    spectatorView.doubleRiskActive = room.doubleRiskActive;
    spectatorView.lockedDeclareType = room.lockedDeclareType;
    spectatorView.rouletteTarget = room.rouletteTarget;
    spectatorView.attackActiveBy = room.attackActiveBy;
    spectatorView.shieldActive = room.shieldActive;
    spectatorView.changePending = room.changePending;
    spectatorView.salvationPending = room.salvationPending;
    spectatorView.replayLog = room.replayLog;
    for (const spectatorSocketId of room.spectators) {
      io.to(spectatorSocketId).emit('game_state_update', spectatorView);
    }
  }
}

// ── ターンタイマー管理 ──────────────────────────
function clearTurnTimer(room: Room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
  }
}

function startTurnTimer(room: Room) {
  clearTurnTimer(room);
  if (!room.gameState) return;

  const phase = room.gameState.phase;
  // タイマー対象: プレイヤーがアクションすべきフェーズのみ
  if (phase !== 'ACTIVE_PLAYER_TURN' && phase !== 'WAITING_RECEIVER_ACTION' && phase !== 'PEEKING' && phase !== 'REVEAL_RESULT') return;

  room.turnDeadline = Date.now() + room.turnTimeoutMs;

  room.turnTimer = setTimeout(() => {
    if (!room.gameState) return;
    console.log(`[タイムアウト] ${room.roomId} phase=${room.gameState.phase}`);
    handleTimeout(room);
  }, room.turnTimeoutMs);
}

function handleTimeout(room: Room) {
  if (!room.gameState) return;
  const state = room.gameState;

  switch (state.phase) {
    case 'ACTIVE_PLAYER_TURN': {
      // 手番プレイヤーがカードを選ばなかった → ランダムにカードを送る
      const current = state.players[state.currentPlayerIndex];
      if (current.hand.length === 0) break;
      const randomCard = current.hand[Math.floor(Math.random() * current.hand.length)];
      const targets = state.players.filter(p => !p.isEliminated && p.playerId !== current.playerId);
      if (targets.length === 0) break;
      const randomTarget = targets[Math.floor(Math.random() * targets.length)];
      const randomCreature = CREATURE_TYPES[Math.floor(Math.random() * CREATURE_TYPES.length)];

      // カード移動
      const cardIndex = current.hand.findIndex(c => c.cardId === randomCard.cardId);
      current.hand.splice(cardIndex, 1);
      state.passingCard = {
        card: randomCard,
        fromPlayerId: current.playerId,
        toPlayerId: randomTarget.playerId,
        declaredType: randomCreature,
        hasBeenPeeked: false,
        passHistory: [current.playerId],
      };
      const receiverIndex = state.players.findIndex(p => p.playerId === randomTarget.playerId);
      state.currentPlayerIndex = receiverIndex;
      state.phase = 'WAITING_RECEIVER_ACTION';
      break;
    }
    case 'WAITING_RECEIVER_ACTION': {
      // 受け手がアクションしなかった → 自動で「嘘だと思う」チャレンジ
      if (!state.passingCard) break;
      const { card, declaredType, fromPlayerId } = state.passingCard;
      const receiverId = state.players[state.currentPlayerIndex].playerId;
      const wasHonest = card.creatureType === declaredType;
      const challengerBelievesLying = true;
      const challengerCorrect = !wasHonest;
      const loserId = challengerCorrect ? fromPlayerId : receiverId;
      const loser = state.players.find(p => p.playerId === loserId)!;
      loser.tableCards.push(card);
      state.revealResult = { card, declaredType, wasHonest, challengerBelievesLying, challengerCorrect, loserId };
      state.phase = 'REVEAL_RESULT';
      break;
    }
    case 'PEEKING': {
      // 確認中にタイムアウト → 自動で「嘘だと思う」チャレンジ
      if (!state.passingCard) break;
      const { card, declaredType, fromPlayerId } = state.passingCard;
      const receiverId = state.players[state.currentPlayerIndex].playerId;
      const wasHonest = card.creatureType === declaredType;
      const challengerBelievesLying = true;
      const challengerCorrect = !wasHonest;
      const loserId = challengerCorrect ? fromPlayerId : receiverId;
      const loser = state.players.find(p => p.playerId === loserId)!;
      loser.tableCards.push(card);
      state.revealResult = { card, declaredType, wasHonest, challengerBelievesLying, challengerCorrect, loserId };
      state.phase = 'REVEAL_RESULT';
      break;
    }
    case 'REVEAL_RESULT': {
      // 結果確認のタイムアウト → 自動で確認を進める
      if (!state.revealResult) break;
      const loser = state.players.find(p => p.playerId === state.revealResult!.loserId)!;
      const eliminationType = checkElimination(loser);
      if (eliminationType) {
        loser.isEliminated = true;
        state.eliminatedPlayers.push(loser.playerId);
        io.to(room.roomId).emit('player_eliminated', {
          playerId: loser.playerId,
          playerName: loser.displayName,
          creatureType: eliminationType,
        });
      }
      const winner = checkGameOver(state.players);
      if (winner) {
        state.winner = winner;
        state.phase = 'GAME_OVER';
        state.passingCard = null;
        state.revealResult = null;
        room.status = 'FINISHED';
        io.to(room.roomId).emit('game_over', { winnerName: winner.displayName, winnerId: winner.playerId });
        broadcastGameState(room);
        return;
      }
      const loserIndex = state.players.findIndex(p => p.playerId === state.revealResult!.loserId);
      let nextIndex = loserIndex;
      if (state.players[nextIndex].isEliminated || state.players[nextIndex].hand.length === 0) {
        nextIndex = findNextActivePlayer(state.players, nextIndex);
      }
      state.currentPlayerIndex = nextIndex;
      state.passingCard = null;
      state.revealResult = null;
      state.turnCount++;
      state.phase = 'ACTIVE_PLAYER_TURN';
      break;
    }
  }

  startTurnTimer(room);
  broadcastGameState(room);
}

// ── Socket.IO ──────────────────────────
io.on('connection', (socket) => {
  console.log(`[接続] ${socket.id}`);

  // ── ルーム作成 ──
  socket.on('create_room', (data, callback) => {
    const roomId = generateRoomId();
    const playerId = `player_0`;
    const room: Room = {
      roomId,
      hostSocketId: socket.id,
      hostPlayerId: playerId,
      maxPlayers: data.maxPlayers ?? 4,
      status: 'WAITING',
      members: new Map([[socket.id, { playerId, displayName: applyTanukiName(data.playerName) }]]),
      disconnectedPlayers: new Map(),
      turnTimer: null,
      turnDeadline: null,
      rematchAccepted: new Set(),
      spectators: new Set(),
      gameMode: data.gameMode || 'normal',
      playerStats: new Map(),
      eventInterval: data.eventInterval || 3,
      activeEvent: null,
      barrierActive: false,
      doubleRiskActive: false,
      lockedDeclareType: null,
      rouletteTarget: null,
      attackActiveBy: null,
      shieldActive: false,
      changePending: false,
      salvationPending: null,
      replayLog: [],
      gameState: null,
      secretMode: data.secretMode ?? false,
      turnTimeoutMs: data.turnTimeout ? data.turnTimeout * 1000 : DEFAULT_TURN_TIMEOUT_MS,
    };
    rooms.set(roomId, room);
    socketToRoom.set(socket.id, roomId);
    playerIdToRoom.set(playerId, roomId);
    socket.join(roomId);
    callback({ ok: true, roomId, playerId });
    broadcastRoomUpdate(room);
    console.log(`[ルーム作成] ${roomId} by ${data.playerName}`);
  });

  // ── ルーム参加 ──
  socket.on('join_room', (data, callback) => {
    const room = rooms.get(data.roomId.toUpperCase());
    if (!room) return callback({ ok: false, error: 'ルームが見つかりません' });
    if (room.status !== 'WAITING') return callback({ ok: false, error: 'このルームは既にゲーム中です' });
    if (room.members.size >= room.maxPlayers) return callback({ ok: false, error: 'ルームが満員です' });

    const playerId = `player_${room.members.size}`;
    room.members.set(socket.id, { playerId, displayName: applyTanukiName(data.playerName) });
    socketToRoom.set(socket.id, data.roomId.toUpperCase());
    playerIdToRoom.set(playerId, room.roomId);
    socket.join(room.roomId);
    callback({ ok: true, playerId });
    broadcastRoomUpdate(room);
    console.log(`[参加] ${data.playerName} → ${room.roomId}`);
  });

  // ── ゲーム再接続 ──
  socket.on('reconnect_game', (data, callback) => {
    const roomId = playerIdToRoom.get(data.playerId);
    if (!roomId) return callback({ ok: false, error: '再接続情報が見つかりません' });

    const room = rooms.get(roomId);
    if (!room) {
      playerIdToRoom.delete(data.playerId); // Room no longer exists
      return callback({ ok: false, error: 'ルームが見つかりません' });
    }

    const disconnectedPlayer = room.disconnectedPlayers.get(data.playerId);
    if (!disconnectedPlayer) return callback({ ok: false, error: 'このプレイヤーは切断していません、または猶予期間が過ぎました' });

    clearTimeout(disconnectedPlayer.timer);
    room.disconnectedPlayers.delete(data.playerId);

    room.members.set(socket.id, { playerId: data.playerId, displayName: disconnectedPlayer.displayName });
    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    // ホストが再接続した場合、ホスト情報を更新
    if (room.hostPlayerId === data.playerId) {
      room.hostSocketId = socket.id;
    }

    callback({ ok: true, roomId, playerId: data.playerId });
    io.to(room.roomId).emit('player_reconnected', {
      playerId: data.playerId,
      playerName: disconnectedPlayer.displayName,
    });
    broadcastRoomUpdate(room);
    broadcastGameState(room);
    console.log(`[再接続] ${disconnectedPlayer.displayName} → ${room.roomId}`);
  });

  // ── ゲーム開始 ──
  socket.on('start_game', (callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return callback({ ok: false, error: 'ルームに参加していません' });
    const room = rooms.get(roomId);
    if (!room) return callback({ ok: false, error: 'ルームが見つかりません' });
    if (room.hostSocketId !== socket.id) return callback({ ok: false, error: 'ホストのみがゲームを開始できます' });
    if (room.members.size < 2) return callback({ ok: false, error: '2人以上必要です' });

    // ゲーム状態を初期化
    const deck = shuffleDeck(createDeck());
    const memberList = Array.from(room.members.values());
    const { hands } = dealCards(deck, memberList.length);

    const players: Player[] = memberList.map((m, i) => ({
      playerId: m.playerId,
      displayName: m.displayName,
      hand: hands[i],
      tableCards: [],
      isEliminated: false,
      seatIndex: i,
      sp: 0,
    }));

    const startIndex = Math.floor(Math.random() * players.length);

    room.gameState = {
      phase: 'ACTIVE_PLAYER_TURN',
      players,
      currentPlayerIndex: startIndex,
      passingCard: null,
      turnCount: 1,
      eliminatedPlayers: [],
      winner: null,
      revealResult: null,
    };
    room.status = 'IN_GAME';

    // 統計データ初期化
    room.playerStats.clear();
    for (const p of players) {
      room.playerStats.set(p.playerId, createEmptyStats());
    }

    callback({ ok: true });
    // リプレイログ: ゲーム開始
    room.replayLog = [];
    const playerNames = players.map(p => p.displayName).join(', ');
    addReplayLog(room, 'GAME_START', '', playerNames + ' でゲーム開始！', '🎮');
    broadcastRoomUpdate(room);
    startTurnTimer(room);
    broadcastGameState(room);
    console.log(`[ゲーム開始] ${roomId} (${memberList.length}人)`);
  });

  // ── カード選択 ──
  socket.on('select_card', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    const state = room.gameState!;

    if (state.phase !== 'ACTIVE_PLAYER_TURN') return callback({ ok: false, error: 'カードを選択できるフェーズではありません' });
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer.playerId !== playerId) return callback({ ok: false, error: 'あなたのターンではありません' });

    const cardIndex = currentPlayer.hand.findIndex(c => c.cardId === data.cardId);
    if (cardIndex === -1) return callback({ ok: false, error: 'そのカードは手札にありません' });

    const targetValid = getTargetPlayers(state).some(p => p.playerId === data.targetPlayerId);
    if (!targetValid) return callback({ ok: false, error: '無効なターゲットです' });

    if (!CREATURE_TYPES.includes(data.declaredType)) return callback({ ok: false, error: '無効な宣言です' });

    // イベント: ロック制限チェック
    if (room.lockedDeclareType && data.declaredType !== room.lockedDeclareType) {
      return callback({ ok: false, error: `ロック中！「${room.lockedDeclareType}」としか宣言できません` });
    }

    // イベント: ルーレット制限チェック
    if (room.rouletteTarget && data.targetPlayerId !== room.rouletteTarget) {
      return callback({ ok: false, error: 'ルーレット中！指定されたプレイヤーにしか渡せません' });
    }

    // カード移動
    const card = currentPlayer.hand[cardIndex];
    currentPlayer.hand.splice(cardIndex, 1);

    state.passingCard = {
      card,
      fromPlayerId: currentPlayer.playerId,
      toPlayerId: data.targetPlayerId,
      declaredType: data.declaredType,
      hasBeenPeeked: false,
      passHistory: [currentPlayer.playerId],
    };

    const receiverIndex = state.players.findIndex(p => p.playerId === data.targetPlayerId);
    state.currentPlayerIndex = receiverIndex;
    state.phase = 'WAITING_RECEIVER_ACTION';

    // リプレイログ: カード宣言
    const targetName = state.players.find(p => p.playerId === data.targetPlayerId)?.displayName ?? '?';
    const ci = CREATURE_INFO[data.declaredType];
    addReplayLog(room, 'DECLARE', currentPlayer.displayName, ci.emoji + ' ' + ci.name + ' を宣言して ' + targetName + ' に送った', ci.emoji);

    // 統計: 宣言カウント
    const senderStats = room.playerStats.get(playerId);
    if (senderStats) {
      senderStats.declarationCounts[data.declaredType] = (senderStats.declarationCounts[data.declaredType] || 0) + 1;
    }

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── チャレンジ ──
  socket.on('challenge', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    const state = room.gameState!;

    if (state.phase !== 'WAITING_RECEIVER_ACTION') return callback({ ok: false, error: 'チャレンジできるフェーズではありません' });
    if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
    if (!state.passingCard) return callback({ ok: false, error: '移動中のカードがありません' });

    // スキル: シールド効果チェック
    if (room.shieldActive) {
      room.shieldActive = false;
      return callback({ ok: false, error: 'シールド効果中！チャレンジできません。パスしてください' });
    }

    const { card, declaredType, fromPlayerId } = state.passingCard;
    const receiverId = playerId;
    const wasHonest = card.creatureType === declaredType;
    const challengerBelievesLying = data.believeIsLying;

    // 受け手の予想が当たった → 送り手が引き取り / 外れた → 受け手が引き取り
    const challengerCorrect = challengerBelievesLying ? !wasHonest : wasHonest;
    const loserId = challengerCorrect ? fromPlayerId : receiverId;

    // カードをテーブルに置く
    const loser = state.players.find(p => p.playerId === loserId)!;
    // イベント: バリア効果 — チャレンジ失敗でもカードを受け取らない
    if (room.barrierActive && !challengerCorrect) {
      // バリア発動: カードを送り手の手札に戻す
      const sender = state.players.find(p => p.playerId === fromPlayerId)!;
      sender.hand.push(card);
      room.barrierActive = false;
    } else {
      loser.tableCards.push(card);
    }

    // イベント: ダブルリスク効果 — チャレンジ失敗時に手札からランダム1枚追加で場に出す
    if (room.doubleRiskActive && !challengerCorrect && loser.hand.length > 0) {
      const randIdx = Math.floor(Math.random() * loser.hand.length);
      const extraCard = loser.hand.splice(randIdx, 1)[0];
      loser.tableCards.push(extraCard);
    }

    state.revealResult = { card, declaredType, wasHonest, challengerBelievesLying, challengerCorrect, loserId };
    state.phase = 'REVEAL_RESULT';

    // リプレイログ: チャレンジ結果
    const receiverName = state.players.find(p => p.playerId === receiverId)?.displayName ?? '?';
    const challengeAction = challengerBelievesLying ? '嘘だと思う' : '本当だと思う';
    addReplayLog(room, 'CHALLENGE', receiverName, challengeAction, challengerBelievesLying ? '❌' : '✅');
    const actualInfo = CREATURE_INFO[card.creatureType];
    const resultText = challengerCorrect
      ? '予想的中！送り手がカードを引き取り'
      : '予想ハズレ！受け手がカードを引き取り';
    addReplayLog(room, 'RESULT', loser.displayName, actualInfo.emoji + ' ' + actualInfo.name + ' — ' + resultText, challengerCorrect ? '✅' : '❌');

    // 統計記録
    const challengerStats = room.playerStats.get(receiverId);
    const senderStats = room.playerStats.get(fromPlayerId);
    if (challengerStats) {
      challengerStats.challengeCount++;
      // 「即チャレンジ」判定: passHistoryが1人分（送り手のみ）なら回さずに即チャレンジ
      const isImmediate = state.passingCard!.passHistory.length === 1;
      if (challengerCorrect) {
        challengerStats.detectSuccess++;
        if (isImmediate) challengerStats.immediateChallengeSuccess++;
      } else {
        challengerStats.detectFail++;
        if (isImmediate) challengerStats.immediateChallengeFail++;
      }
    }
    if (senderStats) {
      if (wasHonest) {
        // 正直宣言
        if (challengerCorrect) senderStats.truthSuccess++; // チャレンジされて相手が「本当」と当てた
      } else {
        // 嘘の宣言
        if (challengerCorrect) senderStats.bluffFail++; // 嘘がバレた
        else senderStats.bluffSuccess++; // 嘘が通った
      }
    }

    // スキルモード: SP獲得
    if (room.gameMode === 'skill') {
      const MAX_SP = 5;
      const receiver = state.players.find(p => p.playerId === receiverId)!;
      const senderPlayer = state.players.find(p => p.playerId === fromPlayerId)!;
      if (challengerCorrect) {
        // チャレンジ成功（嘘を見抜いた）: +2SP
        receiver.sp = Math.min(MAX_SP, receiver.sp + 2);
      }
      if (wasHonest && challengerCorrect) {
        // 正直宣言でチャレンジを誘って成功: +1SP
        senderPlayer.sp = Math.min(MAX_SP, senderPlayer.sp + 1);
      }
      if (!wasHonest && !challengerCorrect) {
        // ブラフ成功（嘘を信じさせた）: +1SP
        senderPlayer.sp = Math.min(MAX_SP, senderPlayer.sp + 1);
      }
    }

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── カード確認（パス前） ──
  socket.on('peek_card', (callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    const state = room.gameState!;

    if (state.phase !== 'WAITING_RECEIVER_ACTION') return callback({ ok: false, error: 'カードを確認できるフェーズではありません' });
    if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
    if (!state.passingCard) return callback({ ok: false, error: '移動中のカードがありません' });

    state.passingCard.hasBeenPeeked = true;
    state.phase = 'PEEKING';

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── カードを回す ──
  socket.on('pass_card', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    const state = room.gameState!;

    if (state.phase !== 'PEEKING') return callback({ ok: false, error: 'カードを回せるフェーズではありません' });
    if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
    if (!state.passingCard) return callback({ ok: false, error: '移動中のカードがありません' });

    const passable = getPassableTargets(state);
    if (!passable.some(p => p.playerId === data.targetPlayerId)) return callback({ ok: false, error: '無効なターゲットです' });
    if (!CREATURE_TYPES.includes(data.declaredType)) return callback({ ok: false, error: '無効な宣言です' });

    // イベント: ロック制限チェック
    if (room.lockedDeclareType && data.declaredType !== room.lockedDeclareType) {
      return callback({ ok: false, error: `ロック中！「${room.lockedDeclareType}」としか宣言できません` });
    }

    state.passingCard.fromPlayerId = playerId;
    state.passingCard.toPlayerId = data.targetPlayerId;
    state.passingCard.declaredType = data.declaredType;
    state.passingCard.hasBeenPeeked = false;
    state.passingCard.passHistory.push(playerId);

    // 統計: パスカウントと宣言カウント
    const passerStats = room.playerStats.get(playerId);
    if (passerStats) {
      passerStats.passCount++;
      passerStats.declarationCounts[data.declaredType] = (passerStats.declarationCounts[data.declaredType] || 0) + 1;
    }

    const receiverIndex = state.players.findIndex(p => p.playerId === data.targetPlayerId);
    state.currentPlayerIndex = receiverIndex;
    state.phase = 'WAITING_RECEIVER_ACTION';

    // リプレイログ: パス
    const passTargetName = state.players.find(p => p.playerId === data.targetPlayerId)?.displayName ?? '?';
    const passPlayer = state.players.find(p => p.playerId === playerId);
    const pci = CREATURE_INFO[data.declaredType];
    addReplayLog(room, 'PASS', passPlayer?.displayName ?? '?', pci.emoji + ' ' + pci.name + ' を宣言して ' + passTargetName + ' に回した', '👀');

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── 結果確認 ──
  socket.on('confirm_result', (callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    const state = room.gameState!;

    if (state.phase !== 'REVEAL_RESULT') return callback({ ok: false, error: '結果確認フェーズではありません' });
    if (!state.revealResult) return callback({ ok: false, error: '結果がありません' });

    const loser = state.players.find(p => p.playerId === state.revealResult!.loserId)!;

    // 統計: カード受け取り
    const loserStats = room.playerStats.get(loser.playerId);
    if (loserStats) loserStats.cardsReceived++;

    // 統計: 「いつも最後」判定 — パスできる相手が0人の状態でチャレンジした人
    if (state.passingCard) {
      const passable = getPassableTargets(state);
      if (passable.length === 0) {
        const receiverStats = room.playerStats.get(playerId);
        if (receiverStats) receiverStats.lastReceiverCount++;
      }
    }

    // スキル: アタック効果 — チャレンジ成功時、カードを場カード最少プレイヤーに移す
    if (room.attackActiveBy && state.revealResult?.challengerCorrect) {
      const activePlayers = state.players.filter(p => !p.isEliminated);
      const minCards = Math.min(...activePlayers.map(p => p.tableCards.length));
      const minPlayers = activePlayers.filter(p => p.tableCards.length === minCards && p.playerId !== room.attackActiveBy);
      if (minPlayers.length > 0 && loser.tableCards.length > 0) {
        const movedCard = loser.tableCards.pop()!;
        const target = minPlayers[Math.floor(Math.random() * minPlayers.length)];
        target.tableCards.push(movedCard);
      }
    }

    const eliminationType = checkElimination(loser);

    if (eliminationType) {
      loser.isEliminated = true;
      state.eliminatedPlayers.push(loser.playerId);
      // 脱落通知
      io.to(room.roomId).emit('player_eliminated', {
        playerId: loser.playerId,
        playerName: loser.displayName,
        creatureType: eliminationType,
      });
      // リプレイログ: 脱落
      const elimInfo = CREATURE_INFO[eliminationType];
      addReplayLog(room, 'ELIMINATE', loser.displayName, elimInfo.emoji + ' ' + elimInfo.name + ' が4枚で脱落！', '💀');
    }

    // 勝者チェック
    const winner = checkGameOver(state.players);
    if (winner) {
      state.winner = winner;
      state.phase = 'GAME_OVER';
      state.passingCard = null;
      state.revealResult = null;
      room.status = 'FINISHED';
      // リプレイログ: ゲーム終了
      addReplayLog(room, 'GAME_OVER', winner.displayName, winner.displayName + ' の勝利！', '🏆');
      io.to(room.roomId).emit('game_over', {
        winnerName: winner.displayName,
        winnerId: winner.playerId,
      });
      clearTurnTimer(room);
      callback({ ok: true });
      broadcastGameState(room);
      return;
    }

    // 次のターンへ
    // カードを引き取った人（loser）が次の手番
    const loserIndex = state.players.findIndex(p => p.playerId === state.revealResult!.loserId);
    let nextIndex = loserIndex;
    if (state.players[nextIndex].isEliminated || state.players[nextIndex].hand.length === 0) {
      nextIndex = findNextActivePlayer(state.players, nextIndex);
    }

    state.currentPlayerIndex = nextIndex;
    state.passingCard = null;
    state.revealResult = null;
    state.turnCount++;
    state.phase = 'ACTIVE_PLAYER_TURN';

    // イベント効果クリア（ターン終了時）
    clearEventEffects(room);

    // スキル効果クリア（ターン終了時）
    room.attackActiveBy = null;
    room.shieldActive = false;
    room.changePending = false;

    // 次ターンのイベント発動チェック
    if (shouldTriggerEvent(room, state.turnCount)) {
      triggerEvent(room);
    }

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── 再戦 ──
  socket.on('rematch', (callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) {
      // ゲーム終了後はgetPlayerContextがエラーを返すので、直接ルーム検索
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return callback({ ok: false, error: 'ルームに参加していません' });
      const r = rooms.get(roomId);
      if (!r) return callback({ ok: false, error: 'ルームが見つかりません' });
      const member = r.members.get(socket.id);
      if (!member) return callback({ ok: false, error: 'プレイヤーが見つかりません' });

      r.rematchAccepted.add(member.playerId);
      const totalPlayers = r.members.size;

      io.to(r.roomId).emit('rematch_requested', {
        requestedBy: member.displayName,
        acceptedCount: r.rematchAccepted.size,
        totalCount: totalPlayers,
      });

      callback({ ok: true });

      // 全員が受諾 → ゲームリスタート
      if (r.rematchAccepted.size >= totalPlayers) {
        clearTurnTimer(r);
        r.rematchAccepted.clear();

        const deck = shuffleDeck(createDeck());
        const memberList = Array.from(r.members.values());
        const { hands } = dealCards(deck, memberList.length);

        const players: Player[] = memberList.map((m, i) => ({
          playerId: m.playerId,
          displayName: m.displayName,
          hand: hands[i],
          tableCards: [],
          isEliminated: false,
          seatIndex: i,
          sp: 0,
        }));

        const startIndex = Math.floor(Math.random() * players.length);

        r.gameState = {
          phase: 'ACTIVE_PLAYER_TURN',
          players,
          currentPlayerIndex: startIndex,
          passingCard: null,
          turnCount: 1,
          eliminatedPlayers: [],
          winner: null,
          revealResult: null,
        };
        r.status = 'IN_GAME';

        io.to(r.roomId).emit('rematch_start');
        broadcastRoomUpdate(r);
        startTurnTimer(r);
        broadcastGameState(r);
        console.log(`[再戦開始] ${r.roomId}`);
      }
      return;
    }

    // getPlayerContextが成功した場合（GAME_OVERでgameStateがある場合）
    room.rematchAccepted.add(playerId);
    const totalPlayers = room.members.size;

    const member = room.members.get(socket.id)!;
    io.to(room.roomId).emit('rematch_requested', {
      requestedBy: member.displayName,
      acceptedCount: room.rematchAccepted.size,
      totalCount: totalPlayers,
    });

    callback({ ok: true });

    if (room.rematchAccepted.size >= totalPlayers) {
      clearTurnTimer(room);
      room.rematchAccepted.clear();

      const deck = shuffleDeck(createDeck());
      const memberList = Array.from(room.members.values());
      const { hands } = dealCards(deck, memberList.length);

      const players: Player[] = memberList.map((m, i) => ({
        playerId: m.playerId,
        displayName: m.displayName,
        hand: hands[i],
        tableCards: [],
        isEliminated: false,
        seatIndex: i,
        sp: 0,
      }));

      const startIndex = Math.floor(Math.random() * players.length);

      room.gameState = {
        phase: 'ACTIVE_PLAYER_TURN',
        players,
        currentPlayerIndex: startIndex,
        passingCard: null,
        turnCount: 1,
        eliminatedPlayers: [],
        winner: null,
        revealResult: null,
      };
      room.status = 'IN_GAME';

      io.to(room.roomId).emit('rematch_start');
      broadcastRoomUpdate(room);
      startTurnTimer(room);
      broadcastGameState(room);
      console.log(`[再戦開始] ${room.roomId}`);
    }
  });

  // ── チャット ──
  socket.on('send_chat', (data, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return callback({ ok: false, error: 'ルームに参加していません' });
    const room = rooms.get(roomId);
    if (!room) return callback({ ok: false, error: 'ルームが見つかりません' });
    const member = room.members.get(socket.id);
    if (!member) return callback({ ok: false, error: 'プレイヤーが見つかりません' });

    const message = data.message.trim().slice(0, 50); // 50文字制限
    if (!message) return callback({ ok: false, error: '空メッセージ' });

    io.to(room.roomId).emit('chat_message', {
      playerId: member.playerId,
      playerName: member.displayName,
      message,
      timestamp: Date.now(),
    });
    callback({ ok: true });
  });

  // ── 観戦参加 ──
  socket.on('join_as_spectator', (data, callback) => {
    const room = rooms.get(data.roomId);
    if (!room) return callback({ ok: false, error: 'ルームが見つかりません' });

    socket.join(room.roomId);
    socketToRoom.set(socket.id, room.roomId);
    room.spectators.add(socket.id);

    // 観戦者数を全員に通知
    io.to(room.roomId).emit('spectator_update', { spectatorCount: room.spectators.size });

    // ルーム情報を送信
    broadcastRoomUpdate(room);

    // ゲーム中なら状態を送信
    if (room.gameState) {
      const view = filterStateForPlayer(room.gameState, '__spectator__');
      view.turnDeadline = room.turnDeadline;
      io.to(socket.id).emit('game_state_update', view);
    }

    callback({ ok: true });
    console.log(`[観戦] ${socket.id} → ${room.roomId} (観戦者: ${room.spectators.size})`);
  });

  // ── スキル使用 ──
  socket.on('use_skill', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    if (room.gameMode !== 'skill') return callback({ ok: false, error: 'スキルモードではありません' });
    const state = room.gameState!;
    const me = state.players.find(p => p.playerId === playerId)!;

    const SKILL_COSTS: Record<SkillType, number> = { ATTACK: 3, CHANGE: 2, SHIELD: 4, HEAL: 5 };
    const cost = SKILL_COSTS[data.skillType];
    if (me.sp < cost) return callback({ ok: false, error: `SP不足（必要: ${cost}, 所持: ${me.sp}）` });

    switch (data.skillType) {
      case 'ATTACK': {
        // チャレンジ前に使用: 受け手がカードを受け取った時、場カード最少プレイヤーに変更
        if (state.phase !== 'WAITING_RECEIVER_ACTION') return callback({ ok: false, error: 'チャレンジ前にしか使えません' });
        if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
        me.sp -= cost;
        room.attackActiveBy = playerId;
        break;
      }
      case 'CHANGE': {
        // カードを渡された時: 渡し先を自分以外に選び直させる
        if (state.phase !== 'WAITING_RECEIVER_ACTION') return callback({ ok: false, error: 'カードを受け取った時にしか使えません' });
        if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
        if (!state.passingCard) return callback({ ok: false, error: '移動中のカードがありません' });
        // 自分以外で回せる相手がいるか確認
        const otherTargets = state.players.filter(p =>
          !p.isEliminated && p.playerId !== playerId && !state.passingCard!.passHistory.includes(p.playerId)
        );
        if (otherTargets.length === 0) return callback({ ok: false, error: '他に回せるプレイヤーがいません' });
        me.sp -= cost;
        // changePendingをセットし、送り手(相手)にターゲット選択を委ねる
        room.changePending = true;
        break;
      }
      case 'SHIELD': {
        // パス前: パス先がチャレンジ不可
        if (state.phase !== 'PEEKING') return callback({ ok: false, error: '確認後（パス前）にしか使えません' });
        if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたの番ではありません' });
        me.sp -= cost;
        room.shieldActive = true;
        break;
      }
      case 'HEAL': {
        // ターン開始時: 場のカード1枚を手札に戻す
        if (state.phase !== 'ACTIVE_PLAYER_TURN') return callback({ ok: false, error: 'ターン開始時にしか使えません' });
        if (state.players[state.currentPlayerIndex].playerId !== playerId) return callback({ ok: false, error: 'あなたのターンではありません' });
        if (me.tableCards.length === 0) return callback({ ok: false, error: '場にカードがありません' });
        me.sp -= cost;
        const idx = data.tableCardIndex ?? me.tableCards.length - 1;
        const healedCard = me.tableCards.splice(idx, 1)[0];
        me.hand.push(healedCard);
        break;
      }
    }

    callback({ ok: true });
    broadcastGameState(room);
  });

  // ── チェンジスキル: 送り手が新ターゲットを選択 ──
  socket.on('change_select_target', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    if (!room.changePending) return callback({ ok: false, error: 'チェンジ待ちではありません' });
    const state = room.gameState!;
    if (!state.passingCard) return callback({ ok: false, error: '移動中のカードがありません' });
    // 送り手のみが選択可能
    if (state.passingCard.fromPlayerId !== playerId) return callback({ ok: false, error: 'あなたは送り手ではありません' });

    const targetId = data.targetPlayerId;
    const currentReceiverPlayerId = state.passingCard.toPlayerId;
    // ターゲット検証: 自分でなく、チェンジ使用者でなく、活動中で、passHistoryに含まれていない
    const target = state.players.find(p => p.playerId === targetId);
    if (!target || target.isEliminated) return callback({ ok: false, error: '無効なターゲットです' });
    if (targetId === playerId) return callback({ ok: false, error: '自分には送れません' });
    if (targetId === currentReceiverPlayerId) return callback({ ok: false, error: 'チェンジ使用者には送れません' });
    if (state.passingCard.passHistory.includes(targetId)) return callback({ ok: false, error: 'すでに回し済みのプレイヤーです' });

    // チェンジ使用者をpassHistoryに追加し、新ターゲットに変更
    state.passingCard.passHistory.push(currentReceiverPlayerId);
    state.passingCard.toPlayerId = targetId;
    const newIdx = state.players.findIndex(p => p.playerId === targetId);
    state.currentPlayerIndex = newIdx;
    room.changePending = false;

    callback({ ok: true });
    startTurnTimer(room);
    broadcastGameState(room);
  });

  // ── 救済イベント: 対象プレイヤーが送り先を選択 ──
  socket.on('salvation_select_target', (data, callback) => {
    const { room, playerId, error } = getPlayerContext(socket.id);
    if (error || !room || !playerId) return callback({ ok: false, error: error || '不明なエラー' });
    if (!room.salvationPending) return callback({ ok: false, error: '救済待ちではありません' });
    const state = room.gameState!;

    // 自分が救済対象か確認
    const myPending = room.salvationPending.find(p => p.playerId === playerId);
    if (!myPending) return callback({ ok: false, error: 'あなたは救済対象ではありません' });

    const targetId = data.targetPlayerId;
    const target = state.players.find(p => p.playerId === targetId);
    if (!target || target.isEliminated) return callback({ ok: false, error: '無効なターゲットです' });
    if (targetId === playerId) return callback({ ok: false, error: '自分には送れません' });

    // 場カード最後の1枚をターゲットに移動
    const me = state.players.find(p => p.playerId === playerId)!;
    if (me.tableCards.length === 0) return callback({ ok: false, error: '場にカードがありません' });
    const cardToMove = me.tableCards.pop()!;
    target.tableCards.push(cardToMove);

    // pendingリストから自分を除去
    room.salvationPending = room.salvationPending.filter(p => p.playerId !== playerId);
    if (room.salvationPending.length === 0) {
      room.salvationPending = null;
    }

    callback({ ok: true });
    broadcastGameState(room);
  });

  // ── ルーム離脱──
  socket.on('leave_room', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const member = room.members.get(socket.id);
        const isHost = socket.id === room.hostSocketId;
        
        // ホストがゲーム中に明示的退室 → ルーム強制クローズ
        if (isHost && room.status === 'IN_GAME') {
          console.log(`[ホスト退室] ${member?.displayName} がルーム ${roomId} を閉じました`);
          clearTurnTimer(room);
          io.to(room.roomId).emit('room_closed', { reason: 'ホストが退室したためゲームが終了しました' });
          // 全メンバー削除
          for (const [sid, m] of room.members) {
            playerIdToRoom.delete(m.playerId);
            socketToRoom.delete(sid);
          }
          for (const [pid, dp] of room.disconnectedPlayers) {
            clearTimeout(dp.timer);
            playerIdToRoom.delete(pid);
          }
          for (const sid of room.spectators) {
            socketToRoom.delete(sid);
          }
          rooms.delete(roomId);
          return;
        }
      }
    }
    handleDisconnect(socket.id);
  });

  // ── 切断 ──
  socket.on('disconnect', () => {
    console.log(`[切断] ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

// ── ヘルパー ──────────────────────────
function getPlayerContext(socketId: string): { room?: Room; playerId?: string; error?: string } {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return { error: 'ルームに参加していません' };
  const room = rooms.get(roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const member = room.members.get(socketId);
  if (!member) return { error: 'プレイヤーが見つかりません' };
  if (!room.gameState) return { error: 'ゲームが開始されていません' };
  return { room, playerId: member.playerId };
}

function handleDisconnect(socketId: string) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  // 観戦者の場合
  if (room.spectators.has(socketId)) {
    room.spectators.delete(socketId);
    socketToRoom.delete(socketId);
    io.to(room.roomId).emit('spectator_update', { spectatorCount: room.spectators.size });
    console.log(`[観戦離脱] ${socketId} (残り観戦者: ${room.spectators.size})`);
    return;
  }

  const member = room.members.get(socketId);
  room.members.delete(socketId);
  socketToRoom.delete(socketId);

  if (!member) {
    if (room.members.size === 0 && room.disconnectedPlayers.size === 0) {
      rooms.delete(roomId);
      console.log(`[ルーム削除] ${roomId}`);
    }
    return;
  }

  // ゲーム中なら猶予期間を設ける
  if (room.status === 'IN_GAME') {
    console.log(`[切断/猶予] ${member.displayName} (${DISCONNECT_TIMEOUT_MS / 1000}秒)`);
    io.to(room.roomId).emit('player_disconnected', {
      playerId: member.playerId,
      playerName: member.displayName,
    });

    const timer = setTimeout(() => {
      // 猶予期間切れ — 完全に削除
      room.disconnectedPlayers.delete(member.playerId);
      playerIdToRoom.delete(member.playerId);
      console.log(`[猶予切れ/削除] ${member.displayName}`);

      if (room.members.size === 0 && room.disconnectedPlayers.size === 0) {
        rooms.delete(roomId);
        console.log(`[ルーム削除] ${roomId}`);
      } else {
        broadcastRoomUpdate(room); // Update room info if room still exists
      }
    }, DISCONNECT_TIMEOUT_MS);

    room.disconnectedPlayers.set(member.playerId, {
      displayName: member.displayName,
      timer,
    });
    broadcastRoomUpdate(room); // Update room info immediately to show disconnected status
  } else {
    // 待機中なら即削除
    playerIdToRoom.delete(member.playerId);

    if (room.members.size === 0) {
      rooms.delete(roomId);
      console.log(`[ルーム削除] ${roomId}`);
      return;
    }

    // ホストが抜けた場合、最初のメンバーをホストに
    if (socketId === room.hostSocketId) {
      const [newHostSocketId, newHost] = room.members.entries().next().value!;
      room.hostSocketId = newHostSocketId;
      room.hostPlayerId = newHost.playerId;
    }

    broadcastRoomUpdate(room);
  }
}

// ── LAN IPアドレス検出 ──────────────────────────
function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ── cloudflared自動起動（アカウント不要） ──────────────────────────
import { spawn, execSync } from 'child_process';

function findCloudflared(): string | null {
  // 1. exe横のcloudflared.exeを探す
  const exeDir = path.dirname(process.execPath);
  const cfBeside = path.join(exeDir, 'cloudflared.exe');
  if (fs.existsSync(cfBeside)) return cfBeside;

  // 2. カレントディレクトリ
  const cfCwd = path.join(process.cwd(), 'cloudflared.exe');
  if (fs.existsSync(cfCwd)) return cfCwd;

  // 3. PATHから探す
  try {
    const result = execSync('where cloudflared', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch { /* not found */ }

  return null;
}

async function startTunnel(port: number): Promise<void> {
  const cfPath = findCloudflared();
  if (!cfPath) {
    console.log('');
    console.log('  ℹ️  インターネット公開するには:');
    console.log('      cloudflared.exe をこのexeと同じフォルダに置いてください');
    console.log('      ダウンロード: https://github.com/cloudflare/cloudflared/releases');
    console.log('      （cloudflared-windows-amd64.exe → cloudflared.exe にリネーム）');
    console.log('');
    console.log('      アカウント作成・ログイン不要で使えます！');
    console.log('');
    console.log('  現在はLAN内のみでプレイ可能です');
    console.log('────────────────────────────────────────────');
    return;
  }

  console.log('');
  console.log('  🌐 トンネル起動中（アカウント不要）...');

  const cfProcess = spawn(cfPath, ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // cloudflaredはstderrにURLを出力する
  let publicUrl: string | null = null;
  const urlPromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);

    const handleData = (data: Buffer) => {
      const line = data.toString();
      // URLのパターンを検出: https://xxxx.trycloudflare.com
      const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !publicUrl) {
        publicUrl = match[0];
        clearTimeout(timeout);
        resolve(publicUrl);
      }
    };

    cfProcess.stderr?.on('data', handleData);
    cfProcess.stdout?.on('data', handleData);
  });

  cfProcess.on('error', (err) => {
    console.log(`  ⚠️ トンネル起動エラー: ${err.message}`);
    console.log('  現在はLAN内のみでプレイ可能です');
    console.log('────────────────────────────────────────────');
  });

  const url = await urlPromise;

  if (url) {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║  🌐 インターネット公開URL:                   ║');
    console.log(`  ║  ${url.padEnd(44)} ║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('  ↑ このURLを友達に送ればどこからでも参加できます！');
    console.log('    アカウント作成は不要です');
  } else {
    console.log('  ⚠️ トンネルURL取得に失敗しました');
    console.log('  LAN内のみでプレイ可能です');
  }
  console.log('────────────────────────────────────────────');

  // プロセス終了時にcloudflaredも停止
  const cleanup = () => {
    try { cfProcess.kill(); } catch { /* already dead */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

// ── 起動 ──────────────────────────
const PORT = parseInt(process.env.PORT || '3001');
httpServer.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('  🪳 はったりポーカー v1.0.2');
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log(`  ▶ ローカル:  http://localhost:${PORT}`);
  console.log(`  ▶ LAN:     http://${localIp}:${PORT}`);
  console.log('');
  console.log('  終了するときは Ctrl+C で停止');

  // ngrok自動起動を試みる
  startTunnel(PORT);
});
