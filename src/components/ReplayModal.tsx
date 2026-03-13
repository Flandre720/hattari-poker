/**
 * リプレイモーダル — ゲーム終了後にアクションログをタイムライン表示
 */

import type { ReplayEntry } from '../../shared/types';

interface ReplayModalProps {
  replayLog: ReplayEntry[];
  onClose: () => void;
}

export function ReplayModal({ replayLog, onClose }: ReplayModalProps) {
  // ターンごとにグループ化
  const groups: { turn: number; entries: ReplayEntry[] }[] = [];
  let currentTurn = -1;

  for (const entry of replayLog) {
    if (entry.turn !== currentTurn) {
      currentTurn = entry.turn;
      groups.push({ turn: currentTurn, entries: [entry] });
    } else {
      groups[groups.length - 1].entries.push(entry);
    }
  }

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-modal" onClick={e => e.stopPropagation()}>
        <div className="replay-header">
          <h2>📜 リプレイ</h2>
          <button className="btn btn-sm btn-outline" onClick={onClose}>✕</button>
        </div>

        <div className="replay-timeline">
          {groups.map((group, gi) => (
            <div key={gi} className="replay-turn-group">
              <div className="replay-turn-label">
                {group.turn === 0 ? '🎮 開始' : `Turn ${group.turn}`}
              </div>
              {group.entries.map((entry, ei) => (
                <div key={ei} className={`replay-entry replay-action-${entry.action.toLowerCase()}`}>
                  <span className="replay-emoji">{entry.emoji}</span>
                  <div className="replay-content">
                    {entry.playerName && (
                      <span className="replay-player">{entry.playerName}</span>
                    )}
                    <span className="replay-detail">{entry.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
