import type { RelRect } from '@tstag/core';
import { useSyncExternalStore } from 'react';

// ロゴの範囲（映像に対する割合）。映像の上で描き、右のタブで画素へ直して送る。
// 描く所（映像）とタブは別の部品なので、ここで持ち合う（元の LogoRectStore）。
// 解析中は範囲を変えさせない（変えても走っている解析には反映されないため）
let rect: RelRect | null = null;
let locked = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const logoRectStore = {
  get: () => rect,
  set(r: RelRect | null) { if (locked) return; rect = r; notify(); },
  isLocked: () => locked,
  setLocked(v: boolean) { locked = v; notify(); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export const useLogoRect = () => useSyncExternalStore(logoRectStore.subscribe, logoRectStore.get, logoRectStore.get);
export const useLogoLocked = () => useSyncExternalStore(logoRectStore.subscribe, logoRectStore.isLocked, logoRectStore.isLocked);
