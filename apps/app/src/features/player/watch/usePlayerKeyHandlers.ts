import type { StreamMeta } from '@tstag/core';
import type { RefObject } from 'react';

import type { useControlsVisibility } from './playerSideEffects';
import type { CommentLayers } from './useCommentLayers';
import { stepSpeed } from '../playerKeys';
import type { VideoSurfaceHandle } from '../surface';
import type { usePlayback } from '../usePlayback';
import type { usePlayerDevicePrefs } from '../usePlayerDevicePrefs';
import { usePlayerKeys } from '../usePlayerKeys';
import { SPEEDS } from '../WatchMenuSheet';

/**
 * キーボード操作（Web。元と同じ割り当て）。その動画で使えない操作は渡さない（一覧にも出さない）。
 * 返す keyHandlers はショートカットの一覧にも使う
 */
export function usePlayerKeyHandlers(o: {
  active: boolean; ui: ReturnType<typeof useControlsVisibility>; surface: RefObject<VideoSurfaceHandle | null>; meta: StreamMeta | undefined; rec: boolean;
  layers: CommentLayers; pb: ReturnType<typeof usePlayback>; prefs: ReturnType<typeof usePlayerDevicePrefs>; durationGuess: number;
  now: () => number; skip: (sec: number) => void; togglePlay: () => void; toggleFullscreen: () => void;
  prevChapter: () => void; nextChapter: () => void; goEpisode: (d: 1 | -1) => void; setRate: (f: (r: number) => number) => void; back: () => void;
  audioToggle?: () => void;
}) {
  const { surface, meta, rec, layers, prefs, durationGuess, now } = o;
  const keyHandlers = {
    togglePlay: o.togglePlay, skip: o.skip,
    adjustVolume: (d: number) => { const v = Math.max(0, Math.min(1, Math.round((prefs.volume + d) * 100) / 100)); prefs.changeVolume(v); prefs.saveVolume(v); },
    toggleMute: prefs.toggleMute, toggleFullscreen: o.toggleFullscreen,
    togglePip: () => surface.current?.startPictureInPicture(),
    toggleCaption: meta?.has_caption ? layers.toggleCaption : undefined,
    toggleComments: meta && layers.hasComments ? layers.toggleComments : undefined,
    toggleAudio: o.audioToggle,
    prevChapter: o.prevChapter, nextChapter: o.nextChapter,
    prevEpisode: rec ? undefined : () => o.goEpisode(-1),
    nextEpisode: rec ? undefined : () => o.goEpisode(1),
    seekRatio: (r: number) => { if (durationGuess) surface.current?.seek(Math.max(0, Math.min(durationGuess, durationGuess * r))); },
    // コマ送りは止めてから。fps が分からないので 1/30 秒ずつ（元と同じ）
    frameStep: (d: number) => { surface.current?.pause(); surface.current?.seek(Math.max(0, Math.min(durationGuess, now() + d / 30))); },
    adjustSpeed: (d: number) => o.setRate((r) => stepSpeed(SPEEDS, r, d)),
    back: o.back,
  };
  const keys = usePlayerKeys(keyHandlers, { enabled: o.active, uiVisible: o.ui.visible, onActivity: o.ui.bump });
  return { keyHandlers, keys };
}
