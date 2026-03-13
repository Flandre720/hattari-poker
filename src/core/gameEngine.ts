/**
 * はったりポーカー — ゲームエンジン
 * 純粋関数ベースのゲームロジック
 */

import type {
  Card, Player, GameState, GameAction, PassingCard, CreatureType,
} from './types';
import { CREATURE_TYPES, CARDS_PER_CREATURE, ELIMINATION_COUNT } from './types';

// ── デッキ生成 ──────────────────────────
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

// ── Fisher-Yates シャッフル ─────────────────
function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ── カード配布 ──────────────────────────
function dealCards(deck: Card[], playerCount: number): { hands: Card[][]; remaining: Card[] } {
  const cardsPerPlayer = Math.floor(deck.length / playerCount);
  const hands: Card[][] = [];
  const dealt = [...deck];

  for (let i = 0; i < playerCount; i++) {
    hands.push(dealt.splice(0, cardsPerPlayer));
  }

  return { hands, remaining: dealt };
}

// ── 敗北チェック ────────────────────────
function checkElimination(player: Player): CreatureType | null {
  const counts: Partial<Record<CreatureType, number>> = {};
  for (const card of player.tableCards) {
    counts[card.creatureType] = (counts[card.creatureType] || 0) + 1;
    if (counts[card.creatureType]! >= ELIMINATION_COUNT) {
      return card.creatureType;
    }
  }
  return null;
}

// ── 次のアクティブプレイヤーを見つける ────────────
function findNextActivePlayer(players: Player[], currentIndex: number): number {
  const count = players.length;
  let next = (currentIndex + 1) % count;
  let attempts = 0;

  while (attempts < count) {
    if (!players[next].isEliminated && players[next].hand.length > 0) {
      return next;
    }
    next = (next + 1) % count;
    attempts++;
  }

  // 全員手札なし→ 手札なしでもプレイヤーが生存していれば次へ
  next = (currentIndex + 1) % count;
  attempts = 0;
  while (attempts < count) {
    if (!players[next].isEliminated) {
      return next;
    }
    next = (next + 1) % count;
    attempts++;
  }

  return currentIndex; // fallback
}

// ── 勝者判定 ────────────────────────────
function checkGameOver(players: Player[]): Player | null {
  const alive = players.filter(p => !p.isEliminated);

  // 生存者が1人→ その人が勝者
  if (alive.length === 1) {
    return alive[0];
  }

  // 全員手札0枚→ テーブルカード最少の人が勝者
  if (alive.every(p => p.hand.length === 0)) {
    const sorted = [...alive].sort((a, b) => {
      if (a.tableCards.length !== b.tableCards.length) {
        return a.tableCards.length - b.tableCards.length;
      }
      // 同数の場合、同種カードの最大数が少ない方が勝ち
      const maxSameA = getMaxSameTypeCount(a);
      const maxSameB = getMaxSameTypeCount(b);
      return maxSameA - maxSameB;
    });
    return sorted[0];
  }

  return null;
}

function getMaxSameTypeCount(player: Player): number {
  const counts: Partial<Record<CreatureType, number>> = {};
  for (const card of player.tableCards) {
    counts[card.creatureType] = (counts[card.creatureType] || 0) + 1;
  }
  return Math.max(0, ...Object.values(counts).map(v => v || 0));
}

// ── 初期ゲーム状態の生成 ─────────────────────
function initGame(playerNames: { name: string }[]): GameState {
  const deck = shuffleDeck(createDeck());
  const { hands } = dealCards(deck, playerNames.length);

  const players: Player[] = playerNames.map((p, i) => ({
    playerId: `player_${i}`,
    displayName: p.name,
    hand: hands[i],
    tableCards: [],
    isEliminated: false,
    seatIndex: i,
  }));

  const startIndex = Math.floor(Math.random() * players.length);

  return {
    phase: 'PLAYER_SWITCHING',
    players,
    currentPlayerIndex: startIndex,
    passingCard: null,
    turnCount: 1,
    eliminatedPlayers: [],
    winner: null,
    revealResult: null,
  };
}

// ── ゲームReducer ──────────────────────────
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME': {
      return initGame(action.players);
    }

    case 'PLAYER_READY': {
      // ホットシート交代完了 → 適切なフェーズへ
      if (state.passingCard && state.passingCard.toPlayerId === state.players[state.currentPlayerIndex].playerId) {
        return { ...state, phase: 'WAITING_RECEIVER_ACTION' };
      }
      return { ...state, phase: 'ACTIVE_PLAYER_TURN' };
    }

    case 'SELECT_CARD': {
      const currentPlayer = state.players[state.currentPlayerIndex];
      const cardIndex = currentPlayer.hand.findIndex(c => c.cardId === action.cardId);
      if (cardIndex === -1) return state;

      const card = currentPlayer.hand[cardIndex];
      const newHand = [...currentPlayer.hand];
      newHand.splice(cardIndex, 1);

      const newPlayers = state.players.map(p =>
        p.playerId === currentPlayer.playerId ? { ...p, hand: newHand } : p
      );

      const passingCard: PassingCard = {
        card,
        fromPlayerId: currentPlayer.playerId,
        toPlayerId: action.targetPlayerId,
        declaredType: action.declaredType,
        hasBeenPeeked: false,
        passHistory: [currentPlayer.playerId],
      };

      // 受け取りプレイヤーの座席インデックスを見つける
      const receiverIndex = newPlayers.findIndex(p => p.playerId === action.targetPlayerId);

      return {
        ...state,
        players: newPlayers,
        passingCard,
        currentPlayerIndex: receiverIndex,
        phase: 'PLAYER_SWITCHING',
      };
    }

    case 'CHALLENGE': {
      if (!state.passingCard) return state;

      const { card, declaredType, fromPlayerId } = state.passingCard;
      const receiverId = state.players[state.currentPlayerIndex].playerId;
      const wasHonest = card.creatureType === declaredType;

      // 正直だった → 受け取り手がカードを引き取る
      // 嘘だった → 渡した側がカードを引き取る
      const loserId = wasHonest ? receiverId : fromPlayerId;

      const newPlayers = state.players.map(p => {
        if (p.playerId === loserId) {
          return { ...p, tableCards: [...p.tableCards, card] };
        }
        return p;
      });

      return {
        ...state,
        players: newPlayers,
        phase: 'REVEAL_RESULT',
        revealResult: { card, declaredType, wasHonest, loserId },
      };
    }

    case 'PEEK_CARD': {
      if (!state.passingCard) return state;
      return {
        ...state,
        passingCard: { ...state.passingCard, hasBeenPeeked: true },
        phase: 'PEEKING',
      };
    }

    case 'PASS_CARD': {
      if (!state.passingCard) return state;

      const currentPlayerId = state.players[state.currentPlayerIndex].playerId;
      const newPassingCard: PassingCard = {
        ...state.passingCard,
        fromPlayerId: currentPlayerId,
        toPlayerId: action.targetPlayerId,
        declaredType: action.declaredType,
        hasBeenPeeked: false,
        passHistory: [...state.passingCard.passHistory, currentPlayerId],
      };

      const receiverIndex = state.players.findIndex(p => p.playerId === action.targetPlayerId);

      return {
        ...state,
        passingCard: newPassingCard,
        currentPlayerIndex: receiverIndex,
        phase: 'PLAYER_SWITCHING',
      };
    }

    case 'CONFIRM_RESULT': {
      if (!state.revealResult) return state;

      const loser = state.players.find(p => p.playerId === state.revealResult!.loserId)!;
      const eliminationType = checkElimination(loser);

      let newPlayers = [...state.players];
      let newEliminated = [...state.eliminatedPlayers];

      if (eliminationType) {
        newPlayers = newPlayers.map(p =>
          p.playerId === loser.playerId ? { ...p, isEliminated: true } : p
        );
        newEliminated.push(loser.playerId);
      }

      // 勝者チェック
      const winner = checkGameOver(newPlayers);
      if (winner) {
        return {
          ...state,
          players: newPlayers,
          eliminatedPlayers: newEliminated,
          passingCard: null,
          revealResult: null,
          winner,
          phase: 'GAME_OVER',
        };
      }

      // チャレンジしたプレイヤー（現在のプレイヤー）が次のターン開始
      let nextIndex = state.currentPlayerIndex;
      // ただし、そのプレイヤーが脱落or手札0の場合は次のプレイヤーへ
      if (newPlayers[nextIndex].isEliminated || newPlayers[nextIndex].hand.length === 0) {
        nextIndex = findNextActivePlayer(newPlayers, nextIndex);
      }

      return {
        ...state,
        players: newPlayers,
        eliminatedPlayers: newEliminated,
        currentPlayerIndex: nextIndex,
        passingCard: null,
        revealResult: null,
        turnCount: state.turnCount + 1,
        phase: 'PLAYER_SWITCHING',
      };
    }

    default:
      return state;
  }
}

// ── ユーティリティ ──────────────────────────

/** パスできる対象を取得（直前に渡してきたプレイヤーを除外） */
export function getPassableTargets(state: GameState): Player[] {
  if (!state.passingCard) return [];
  const currentPlayerId = state.players[state.currentPlayerIndex].playerId;

  return state.players.filter(p =>
    !p.isEliminated &&
    p.playerId !== currentPlayerId &&
    p.playerId !== state.passingCard!.fromPlayerId && // 直前に渡してきた人には回せない
    !state.passingCard!.passHistory.includes(p.playerId) // 既に通過した人にも回せない（オプション）
  );
}

/** カードを出す対象を取得 */
export function getTargetPlayers(state: GameState): Player[] {
  const currentPlayerId = state.players[state.currentPlayerIndex].playerId;
  return state.players.filter(p =>
    !p.isEliminated &&
    p.playerId !== currentPlayerId
  );
}

/** 初期状態 */
export const INITIAL_STATE: GameState = {
  phase: 'SETUP',
  players: [],
  currentPlayerIndex: 0,
  passingCard: null,
  turnCount: 0,
  eliminatedPlayers: [],
  winner: null,
  revealResult: null,
};
