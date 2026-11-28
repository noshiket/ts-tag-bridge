import type { Api } from '@tstag/core';
import { useCallback, useSyncExternalStore } from 'react';
import { tNow } from '../../ui/i18n/I18n';

// 動画を連携先（library_peer）へ移す順番待ち（元の helpers.jsx の PushMaster）。1本ずつ順に送る。
// 確定値の encode_dir を 'master' にしてから relocate する。予約を保存した後に失敗しても、サーバーが自動で送り直す。
// アプリが動いている間だけ持つ（画面を移っても続く）

export type PushState = { status: 'queued' | 'moving' | 'done' | 'error'; error?: string };
const states = new Map<number, PushState>();
const queue: { id: number; node: string | null; api: Api; onDone: () => void }[] = [];
const listeners = new Set<() => void>();
let running = false;
let version = 0;
const notify = () => { version++; listeners.forEach((l) => l()); };

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  states.set(job.id, { status: 'moving' });
  notify();
  let marked = false;
  try {
    await job.api.confirmed.saveVideo(job.id, { encode_dir: 'master' }, job.node);
    marked = true;
    const r = await job.api.videoActions.relocate(job.id, job.node);
    if (r?.relocated !== true) throw new Error(r?.error || tNow('system.pushPeer.notMoved'));
    // 動画はこのサーバーから無くなるので、続きを見るからも外す
    await job.api.watch.remove(`video:${job.id}`).catch(() => {});
    states.set(job.id, { status: 'done' });
    job.onDone();
  } catch (e) {
    const msg = (e instanceof Error ? e.message : tNow('common.moveFailed')) + (marked ? tNow('system.push.retry') : '');
    states.set(job.id, { status: 'error', error: msg });
  } finally {
    running = false;
    notify();
    void pump();
  }
}

export function enqueuePush(id: number, node: string | null, api: Api, onDone: () => void) {
  const st = states.get(id);
  if (st && (st.status === 'queued' || st.status === 'moving')) return;
  states.set(id, { status: 'queued' });
  queue.push({ id, node, api, onDone });
  notify();
  void pump();
}

/** その動画の移動の状態 */
export function usePushState(id: number): PushState | null {
  const sub = useCallback((l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useSyncExternalStore(sub, () => version);
  return states.get(id) ?? null;
}
