// 通信の無い所（飛行機の中など）で見た位置を端末に控え、通信が戻ったらサーバーへ送る（元の Web 版の WatchStore と同じ考え）。
// - 位置を残す時は、まずここへ置いてからサーバーへ送り、届いたら消す（途中でアプリが閉じても残る）
// - 続きの位置は、サーバーの記録とここの控えの新しい方を使う（機内で止めた所から続く）
// - 起動時・前に戻った時・1分ごとに、残っている分をまとめて送る（サーバーは新しい方だけを残す）
import type { Api, WatchEntry } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { readPending, writePending } from './watchPendingStore';

const all = () => readPending() as Record<string, WatchEntry>;

/** 控える（同じ動画は新しい方で上書き） */
export function keepPending(e: WatchEntry) {
  const m = all();
  const old = m[e.fileKey];
  if (old && old.updatedAt > e.updatedAt) return;
  m[e.fileKey] = e;
  writePending(m);
}

/** サーバーへ届いたら消す（届いた後に新しい位置を控えていたら残す） */
export function dropPending(e: WatchEntry) {
  const m = all();
  if (m[e.fileKey]?.updatedAt === e.updatedAt) {
    delete m[e.fileKey];
    writePending(m);
  }
}

/** この動画の控え（無ければ null） */
export const pendingFor = (fileKey: string): WatchEntry | null => all()[fileKey] ?? null;

/** サーバーの記録と控えの新しい方 */
export function newerEntry(a: WatchEntry | null | undefined, b: WatchEntry | null | undefined): WatchEntry | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.updatedAt >= b.updatedAt ? a : b;
}

let flushing = false;
/** 残っている分をまとめて送る */
export async function flushPending(api: Api) {
  if (flushing) return;
  const entries = Object.values(all());
  if (!entries.length) return;
  flushing = true;
  try {
    await api.watch.put(entries);
    for (const e of entries) dropPending(e);
  } catch { /* まだ通信が無い。次の機会に */ } finally { flushing = false; }
}

/** 起動時・前に戻った時・1分ごとに送る（ログインしている間だけ置く） */
export function useWatchPendingSync() {
  const api = useApi();
  useEffect(() => {
    void flushPending(api);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void flushPending(api); });
    const iv = setInterval(() => void flushPending(api), 60_000);
    return () => { sub.remove(); clearInterval(iv); };
  }, [api]);
}
