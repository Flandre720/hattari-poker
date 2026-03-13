/**
 * トースト通知フック
 * 画面右上にフェードイン→自動消去の通知を表示する
 */

import { useState, useCallback, useRef } from 'react';

export type ToastType = 'info' | 'success' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export interface UseToastReturn {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, type }]);
    // 3秒後に自動削除
    setTimeout(() => removeToast(id), 3000);
  }, [removeToast]);

  return { toasts, addToast, removeToast };
}
