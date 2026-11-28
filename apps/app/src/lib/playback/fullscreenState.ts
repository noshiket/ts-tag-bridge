import { useSyncExternalStore } from 'react';

// 再生画面が全画面か（PC の縦の帯を隠すため。元は theater の間 DesktopSidebar を出さない）
let on = false;
const subs = new Set<() => void>();
export const setPlayerFullscreen = (v: boolean) => { if (on !== v) { on = v; subs.forEach((f) => f()); } };
export const usePlayerFullscreen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => on);
