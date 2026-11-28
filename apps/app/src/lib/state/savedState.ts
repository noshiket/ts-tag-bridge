import { useCallback, useSyncExternalStore } from 'react';

/**
 * 画面の外（アプリが動いている間）に持つ表示の状態。再生画面などへ移って戻っても元の表示に戻る。
 * 元の Web 版の _libSaved / _albumDetailSaved と同じ扱い（端末に保存はしない）
 */
export function savedState<S extends object>(initial: S) {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<S>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  return function useSaved(): [S, (patch: Partial<S>) => void] {
    const subscribe = useCallback((l: () => void) => {
      listeners.add(l);
      return () => { listeners.delete(l); };
    }, []);
    return [useSyncExternalStore(subscribe, () => state), set];
  };
}
