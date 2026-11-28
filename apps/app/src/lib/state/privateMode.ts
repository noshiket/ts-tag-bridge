import { useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

// プライベートモード（元の Web 版の privMode）。入っている間は自分の非公開カテゴリの動画も出す。
// ライブラリを開いている間だけ（ライブラリから離れたら切る。元と同じ）

let on = false;
const listeners = new Set<() => void>();
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function usePrivateMode(): [boolean, (v: boolean) => void] {
  const api = useApi();
  const qc = useQueryClient();
  const value = useSyncExternalStore(sub, () => on);
  const set = useCallback((v: boolean) => {
    if (v === on) return;
    on = v;
    api.client.privateMode = v;
    listeners.forEach((l) => l());
    // 出す動画が変わるので取り直す
    void qc.invalidateQueries({ queryKey: ['library'] });
    void qc.invalidateQueries({ queryKey: ['watchHistory'] });
  }, [api, qc]);
  return [value, set];
}
