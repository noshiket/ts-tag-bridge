import { buildSplitSource } from '@tstag/core';
import { useRecording, useRecordingProbe, useSplitEditor } from '@tstag/core/react';
import { useEffect, useMemo, useState, type RefObject } from 'react';

import type { VideoSurfaceHandle } from '../surface';

/**
 * 再生画面の分割: 編集の状態はこの画面が持ち、タブ・シークバー・映像の上（止めている間の厳密なコマ）で分け合う（元と同じ）。
 * 分割タブから本体を動かす: 編集点を動かすと本体も止めてその近くへ
 */
export function useWatchSplit({ rec, tab, videoId, node, surface, now, duration, playing }: {
  rec: boolean; tab: string | null; videoId: number; node: string | null; surface: RefObject<VideoSurfaceHandle | null>;
  now: number; duration: number; playing: boolean;
}) {
  const splitOn = rec && tab === 'split';
  const splitRec = useRecording(videoId, node, splitOn);
  const splitProbe = useRecordingProbe(videoId, node, splitOn);
  const src = useMemo(() => (splitRec.data ? buildSplitSource(splitRec.data) : null), [splitRec.data]);
  const editor = useSplitEditor(src, splitProbe.data?.video?.fps || 29.97);
  const [focusT, setFocusT] = useState(0);
  // 分割タブを開いたら、編集点を今の再生位置にする
  useEffect(() => { if (tab === 'split') setFocusT(now); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const clampT = (t: number) => Math.max(0, Math.min(duration || 0, t));
  const focusSeek = (t: number) => { const nt = clampT(t); setFocusT(nt); surface.current?.seek(nt); surface.current?.pause(); };
  const ctl = {
    focusT, paused: !playing, stepFocus: (d: number) => focusSeek(focusT + d), seek: focusSeek,
    play: () => surface.current?.play(), pause: () => surface.current?.pause(),
  };
  return { active: splitOn && !!src, ready: !!src, error: splitRec.error?.message ?? null, editor, ctl, focusT, setFocusT };
}
