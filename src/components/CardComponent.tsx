import type { Card } from '../../shared/types';
import { CREATURE_INFO } from '../../shared/types';
import { useSecretMode } from '../core/SecretModeContext';
import { useMemo } from 'react';

interface CardComponentProps {
  card?: Card;
  faceDown?: boolean;
  selected?: boolean;
  large?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function CardComponent({ card, faceDown, selected, large, disabled, onClick }: CardComponentProps) {
  const { isSecretMode } = useSecretMode();

  const creatureInfo = useMemo(() => {
    if (!isSecretMode) return CREATURE_INFO;
    return {
      ...CREATURE_INFO,
      SCORPION: { name: 'タヌキ', emoji: '', color: '#D4A574' },
    };
  }, [isSecretMode]);

  if (faceDown || !card) {
    return (
      <div className={`card card-back ${large ? 'card-large' : ''}`} onClick={disabled ? undefined : onClick}>
        ❓
      </div>
    );
  }

  const info = creatureInfo[card.creatureType];
  const isSecretScorpion = isSecretMode && card.creatureType === 'SCORPION';

  return (
    <div
      className={`card ${selected ? 'selected' : ''} ${large ? 'card-large' : ''} ${disabled ? 'card-disabled' : ''}`}
      style={{ backgroundColor: info.color }}
      onClick={disabled ? undefined : onClick}
    >
      <span className="card-emoji">
        {isSecretScorpion ? (
          <img src="/images/poro.png" alt="タヌキ" style={{ width: '1.8em', height: '1.8em', objectFit: 'contain' }} />
        ) : (
          info.emoji
        )}
      </span>
      <span className="card-name">{info.name}</span>
    </div>
  );
}
