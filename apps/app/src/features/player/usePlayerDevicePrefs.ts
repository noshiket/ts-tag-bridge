import { useState } from 'react';

import { deviceStore } from '../../lib/device/deviceStore';
import { VOLUME_KEY, MUTED_KEY, loadVolume } from '../../lib/audio/volumePrefs';

/** 続けて流す（端末ごとの好み。元の Web 版と同じ名前） */
const AUTO_NEXT_KEY = 'tstag_auto_next';

/** 再生画面の、端末に覚える好み（音量・消音・続けて流す） */
export function usePlayerDevicePrefs() {
  // 最後まで再生したら次の話数へ。オフならその場で止まる
  const [autoNext, setAutoNext] = useState(() => deviceStore.get(AUTO_NEXT_KEY) === '1');
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(() => deviceStore.get(MUTED_KEY) === '1');
  return {
    autoNext, volume, muted,
    // なぞっている間は変えるだけ、離した時に保存する（iOS の保存先は毎回書くと重い）
    changeVolume: (v: number) => { setVolume(v); setMuted(false); },
    saveVolume: (v: number) => { deviceStore.set(VOLUME_KEY, String(v)); deviceStore.set(MUTED_KEY, '0'); },
    toggleMute: () => { deviceStore.set(MUTED_KEY, muted ? '0' : '1'); setMuted(!muted); },
    toggleAutoNext: () => { deviceStore.set(AUTO_NEXT_KEY, autoNext ? '0' : '1'); setAutoNext(!autoNext); },
  };
}
