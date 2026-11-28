import { REPEAT_KEY, adjacentInQueue, nextRepeat, parseRepeat, shuffleIds, type Repeat } from '@tstag/core';
import { useCallback, useSyncExternalStore } from 'react';

import { deviceStore } from '../device/deviceStore';

// 音楽の再生の並び（元の helpers.jsx の MusicQueue）。アルバム・プレイリスト・シャッフルで積み、
// 今の曲がこの並びにあれば、再生画面の前/次と曲の終わりはこの並びで送る。繰り返しは端末に残す

let ids: number[] = [];
let node: string | null = null;
let repeat: Repeat = parseRepeat(deviceStore.get(REPEAT_KEY));
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((l) => l()); };

export const musicQueue = {
  set(next: number[], srcNode: string | null) { ids = [...next]; node = srcNode; notify(); },
  /** 混ぜて入れる（first を1曲目に）。入れた並びを返す */
  shuffle(next: number[], srcNode: string | null, first: number | null = null) { const a = shuffleIds(next, first); musicQueue.set(a, srcNode); return a; },
  has: (id: number) => ids.includes(id),
  node: () => node,
  repeat: () => repeat,
  cycleRepeat() { repeat = nextRepeat(repeat); deviceStore.set(REPEAT_KEY, repeat); notify(); return repeat; },
  adjacent: (id: number, direction: number) => adjacentInQueue(ids, id, direction, repeat),
};

/** 並び・繰り返しが変わったら描き直す */
export function useMusicQueue() {
  const sub = useCallback((l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useSyncExternalStore(sub, () => version);
  return musicQueue;
}
