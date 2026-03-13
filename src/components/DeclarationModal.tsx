import type { CreatureType } from '../../shared/types';
import { CREATURE_INFO, CREATURE_TYPES } from '../../shared/types';
import { useSecretMode } from '../core/SecretModeContext';
import { useMemo } from 'react';

interface DeclarationModalProps {
  onSelect: (type: CreatureType) => void;
  onCancel: () => void;
  title?: string;
  /** ロック中に指定された宣言タイプ（この種類以外はグレーアウト） */
  lockedType?: CreatureType | null;
}

export function DeclarationModal({ onSelect, onCancel, title = '宣言する生き物を選択', lockedType }: DeclarationModalProps) {
  const { isSecretMode } = useSecretMode();

  const creatureInfo = useMemo(() => {
    if (!isSecretMode) return CREATURE_INFO;
    return {
      ...CREATURE_INFO,
      SCORPION: { name: 'タヌキ', emoji: '', color: '#D4A574' },
    };
  }, [isSecretMode]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        {lockedType && (
          <p style={{ color: 'var(--warning)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            🔒 ロック中！{creatureInfo[lockedType].emoji || creatureInfo[lockedType].name} のみ宣言可能
          </p>
        )}
        <div className="creature-grid">
          {CREATURE_TYPES.map(type => {
            const info = creatureInfo[type];
            const isLocked = lockedType != null && type !== lockedType;
            const isSecretScorpion = isSecretMode && type === 'SCORPION';
            return (
              <button
                key={type}
                className="creature-btn"
                onClick={() => onSelect(type)}
                disabled={isLocked}
                style={isLocked ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              >
                <span className="emoji">
                  {isSecretScorpion ? (
                    <img src="/images/poro.png" alt="タヌキ" style={{ width: '1.5em', height: '1.5em', objectFit: 'contain' }} />
                  ) : (
                    info.emoji
                  )}
                </span>
                <span className="name">{info.name}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-outline" onClick={onCancel} style={{ width: '100%' }}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
