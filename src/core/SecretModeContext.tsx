/**
 * 隠しモード用 Context
 * コナミコマンド（↑↑↓↓←→←→）で発動
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface SecretModeContextType {
  isSecretMode: boolean;
  activateSecretMode: () => void;
}

const SecretModeContext = createContext<SecretModeContextType>({
  isSecretMode: false,
  activateSecretMode: () => {},
});

export function SecretModeProvider({ children }: { children: ReactNode }) {
  const [isSecretMode, setIsSecretMode] = useState(false);

  const activateSecretMode = useCallback(() => {
    setIsSecretMode(true);
  }, []);

  return (
    <SecretModeContext.Provider value={{ isSecretMode, activateSecretMode }}>
      {children}
    </SecretModeContext.Provider>
  );
}

export function useSecretMode() {
  return useContext(SecretModeContext);
}
