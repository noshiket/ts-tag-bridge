import { useEffect, useState } from 'react';

import { deviceStore } from '../../../lib/device/deviceStore';
import { VOLUME_KEY, MUTED_KEY, loadVolume, clampVolume } from '../../../lib/audio/volumePrefs';
import type { LiveSurfaceHandle } from '../surface';

/**
 * 音量・消音・字幕・弾幕・主/副音声の切り替え。変えたらすぐプレイヤーのページへ送る。
 * 副音声の無い番組に変わったら主音声へ戻す
 */
export function useLiveToggles(cmd: LiveSurfaceHandle['command'], hasSecondary: boolean) {
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(() => deviceStore.get(MUTED_KEY) === '1');
  const [captionOn, setCaptionOn] = useState(true);
  const [commentsOn, setCommentsOn] = useState(true);
  const [audioTrack, setAudioTrack] = useState<'main' | 'sub'>('main');

  useEffect(() => {
    if (!hasSecondary && audioTrack === 'sub') { setAudioTrack('main'); cmd({ type: 'audio', track: 'main' }); }
  }, [hasSecondary, audioTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVol = (v: number, m: boolean) => { setVolume(v); setMuted(m); cmd({ type: 'volume', volume: v, muted: m }); };
  /** 音量を決めた（つまみを離した・キーで変えた）ら端末に覚えて消音を解く */
  const saveVol = (v: number) => { deviceStore.set(VOLUME_KEY, String(v)); deviceStore.set(MUTED_KEY, '0'); };
  return {
    volume, muted, captionOn, commentsOn, audioTrack, setVol, saveVol,
    adjustVolume: (d: number) => { const v = clampVolume(Math.round((volume + d) * 100) / 100); setVol(v, false); saveVol(v); },
    toggleMute: () => { const m = !muted; deviceStore.set(MUTED_KEY, m ? '1' : '0'); setVol(volume, m); },
    toggleCaption: () => { const n = !captionOn; setCaptionOn(n); cmd({ type: 'caption', on: n }); },
    toggleComments: () => { const n = !commentsOn; setCommentsOn(n); cmd({ type: 'comments', on: n }); },
    toggleAudio: () => { const n = audioTrack === 'main' ? 'sub' : 'main'; setAudioTrack(n); cmd({ type: 'audio', track: n }); },
  };
}

export type LiveToggles = ReturnType<typeof useLiveToggles>;
