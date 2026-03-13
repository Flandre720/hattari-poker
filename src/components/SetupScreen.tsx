import { useState } from 'react';
import type { GameAction } from '../core/types';

interface SetupScreenProps {
  dispatch: React.Dispatch<GameAction>;
}

export function SetupScreen({ dispatch }: SetupScreenProps) {
  const [playerCount, setPlayerCount] = useState(4);
  const [names, setNames] = useState<string[]>(['', '', '', '', '', '']);

  const handleStart = () => {
    const players = names
      .slice(0, playerCount)
      .map((name, i) => ({ name: name.trim() || `プレイヤー${i + 1}` }));
    dispatch({ type: 'START_GAME', players });
  };

  return (
    <div className="setup-screen">
      <h1>
        <span className="emoji">🪳</span> はったりポーカー
      </h1>

      <div className="setup-card">
        <h2>プレイヤー人数</h2>
        <div className="player-count-selector">
          {[2, 3, 4, 5, 6].map(n => (
            <button
              key={n}
              className={`player-count-btn ${playerCount === n ? 'active' : ''}`}
              onClick={() => setPlayerCount(n)}
            >
              {n}人
            </button>
          ))}
        </div>

        <h2>プレイヤー名</h2>
        {Array.from({ length: playerCount }, (_, i) => (
          <input
            key={i}
            className="player-name-input"
            placeholder={`プレイヤー${i + 1}`}
            value={names[i]}
            onChange={e => {
              const newNames = [...names];
              newNames[i] = e.target.value;
              setNames(newNames);
            }}
          />
        ))}
      </div>

      <button className="btn btn-primary" onClick={handleStart} style={{ fontSize: '1.2rem', padding: '16px 48px' }}>
        🎮 ゲーム開始
      </button>
    </div>
  );
}
