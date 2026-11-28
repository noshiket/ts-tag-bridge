import { localKey, parseLocalKey, sortLocalItems, type LocalItem } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useRef, useSyncExternalStore } from 'react';

import { loadIndex, pendingMeta, rememberApi } from './downloadQueue';
import { getSnap, subscribe, type ActiveItem, type Snap } from './snapshot';

/** 初めて読む時に一覧を読み、起動時に書きかけの続きを取るためにサーバーへの口を控えておく */
function useSubscribe() {
  rememberApi(useApi());
  return useCallback((l: () => void) => { const off = subscribe(l); void loadIndex(); return off; }, []);
}

/**
 * 保存の状態の一部だけを読む。選んだ部分が変わった時だけ描き直す（保存中は進み具合が 0.5% ごとに変わり、
 * useLocalSave() で全部を読む画面はそのたびに丸ごと描き直す。再生画面や一覧のカードでそうしていたため、
 * 保存しながら再生すると画面の処理が数秒ずつ止まり、操作が効かなくなった）
 */
export function useLocalSaveSelect<T>(select: (s: Snap) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const sub = useSubscribe();
  const last = useRef<{ v: T } | null>(null);
  const get = () => {
    const v = select(getSnap());
    if (last.current && eq(last.current.v, v)) return last.current.v;
    last.current = { v };
    return v;
  };
  return useSyncExternalStore(sub, get);
}

/** 浅い比較（{saved, active} のような小さな組を選ぶ時に） */
export const shallowEq = <T extends object>(a: T, b: T) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);

/** ローカル保存の今の状態（変わったら描き直す）。初めて呼んだ時に一覧を読む */
export function useLocalSave() {
  return useSyncExternalStore(useSubscribe(), getSnap);
}

/** その動画の保存の様子 */
export function localStateOf(s: Snap, id: number, node: string | null) {
  const ck = localKey(id, node);
  return { saved: s.index[ck] ?? null, active: s.states[ck] ?? null };
}

/** 保存済みの一覧（そのサーバーの分。新しい順） */
export function localItems(s: Snap, node: string | null): LocalItem[] {
  return sortLocalItems(Object.entries(s.index)
    .map(([ck, m]) => ({ ...m, ...parseLocalKey(ck) }))
    .filter((it) => (it.node || null) === (node || null)));
}

/** 保存中・待機中（そのサーバーの分。node を省くと全部） */
export function activeItems(s: Snap, node?: string | null): ActiveItem[] {
  return Object.entries(s.states)
    .filter(([, st]) => st.status !== 'error')
    .map(([ck, st]) => ({ ...(pendingMeta(ck) ?? {}), ...parseLocalKey(ck), status: st.status, progress: st.progress, error: st.error }))
    .filter((it) => node === undefined || (it.node || null) === (node || null));
}
