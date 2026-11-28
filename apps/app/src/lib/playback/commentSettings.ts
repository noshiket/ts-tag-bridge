import { MUTE_SETTINGS_KEY, parseMuteSettings, type MuteSettings } from '@tstag/core';
import { useSyncExternalStore } from 'react';

import { deviceStore } from '../device/deviceStore';

// 実況のミュートと弾幕の表示（端末ごと。元の Web 版と同じ名前で保存する）。
// 変えるとすぐ弾幕に効くよう、使っている所へ知らせる
let current: MuteSettings | null = null;
const listeners = new Set<() => void>();
const get = () => (current ??= parseMuteSettings(deviceStore.get(MUTE_SETTINGS_KEY)));
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function updateCommentSettings(patch: Partial<MuteSettings>) {
  current = { ...get(), ...patch };
  deviceStore.set(MUTE_SETTINGS_KEY, JSON.stringify(current));
  listeners.forEach((l) => l());
}

export const useCommentSettings = () => useSyncExternalStore(subscribe, get);
