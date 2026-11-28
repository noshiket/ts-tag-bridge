import { useSyncExternalStore } from 'react';

// 下の帯のサムネの枠の位置（画面の左上からの座標）。帯にいる間は、再生中のプレイヤーそのものを
// この枠の大きさへ縮めて出す（PlayerHost）。
// 帯（タブバー）は画面ごとに置かれ、スタックの奥の画面にも残っている。前に出ている画面の帯だけが枠を持つ

export interface BandRect { x: number; y: number; width: number; height: number }

let owner: number | null = null;
let rect: BandRect | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const miniBand = {
  /** その帯の枠を載せる（null で、その帯が持っている時だけ外す） */
  set(id: number, r: BandRect | null) {
    if (r) {
      if (owner === id && rect && rect.x === r.x && rect.y === r.y && rect.width === r.width && rect.height === r.height) return;
      owner = id; rect = r; emit(); return;
    }
    if (owner === id) { owner = null; rect = null; emit(); }
  },
};

export function useMiniBandRect(): BandRect | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => rect);
}
