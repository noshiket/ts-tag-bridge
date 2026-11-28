import type { LocalItem, LocalSaveMeta } from '@tstag/core';
import { tNow } from '../../ui/i18n/I18n';

// ローカル保存の状態。変わるたびに別の物にする
// （React Compiler が同じ物から読んだ値を覚えてしまうため。ミニプレイヤーで起きた）

export type ActiveState = { status: 'queued' | 'downloading' | 'error'; progress: number; error?: string };
/** 待っている間の表示（取れた所までがあれば % を添える） */
export const queuedLabel = (progress: number) => (progress > 0 ? `${tNow('system.snapshot.waiting')} ${Math.round(progress * 100)}%` : tNow('system.snapshot.waiting'));
export interface ActiveItem extends LocalItem { status: ActiveState['status']; progress: number; error?: string }

export interface Snap {
  ready: boolean;
  /** 保存済み（鍵 → 控えた情報） */
  index: Record<string, LocalSaveMeta>;
  /** 待機・保存中・失敗 */
  states: Record<string, ActiveState>;
}
let snap: Snap = { ready: false, index: {}, states: {} };
const listeners = new Set<() => void>();

export const getSnap = () => snap;
export const setSnap = (p: Partial<Snap>) => { snap = { ...snap, ...p }; listeners.forEach((l) => l()); };
export const setActive = (ck: string, st: ActiveState | null) => {
  const states = { ...snap.states };
  if (st) states[ck] = st; else delete states[ck];
  setSnap({ states });
};
/** 変わったら知らせてもらう（返り値で外す） */
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
