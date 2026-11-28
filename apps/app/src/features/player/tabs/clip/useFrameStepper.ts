import { frameAt, frameTimes, snapToFrame, type FrameTable } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useMemo, useState } from 'react';

type Times = ArrayLike<number>;

/** フレーム表 → 各コマの時刻。gzip を解けない環境（iOS）では空＝秒指定のまま切り出す（元と同じ） */
async function decodeTable(t: FrameTable | null | undefined): Promise<Times> {
  try {
    if (!t?.index || !t.deltas || typeof DecompressionStream === 'undefined') return [];
    const bytes = Uint8Array.from(atob(t.index), (ch) => ch.charCodeAt(0));
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return frameTimes(new Uint8Array(buf), t);
  } catch { return []; }
}

/**
 * コマ送り: フレーム表（あれば実際のコマへ吸着）・表示するコマの番号と時刻・止まった所の静止画。
 * コマ送りは番号を直接動かす（再生位置から引き直すとシークのずれで同じ番号へ丸まり、押しても変わらないことがある）
 */
export function useFrameStepper(videoId: number, node: string | null, time: number, playing: boolean, pause: () => void, seek: (sec: number) => void) {
  const api = useApi();
  const [times, setTimes] = useState<Times | null>(null);
  useEffect(() => {
    let dead = false;
    setTimes(null);
    api.videoActions.frameTable(videoId, node).then((d) => decodeTable(d?.table)).catch(() => [] as Times)
      .then((t) => { if (!dead) setTimes(t); });
    return () => { dead = true; };
  }, [api, videoId, node]);

  const has = !!times?.length;
  const snap = (sec: number) => (has ? snapToFrame(times!, sec) : sec);
  const frameOf = (sec: number) => (has ? frameAt(times!, sec) : -1);
  const [shownIdx, setShownIdx] = useState<number | null>(null);
  useEffect(() => { setShownIdx(null); }, [videoId]);
  useEffect(() => { if (playing) setShownIdx(null); }, [playing]);
  const curIdx = shownIdx ?? frameOf(time);
  const shownT = has && curIdx >= 0 ? times![curIdx]! : time;

  // 静止画は止まってから取りに行く（コマ送りの連打で途中のコマまで全部読まないように）。番号と時刻はすぐ動かす
  const [imgT, setImgT] = useState<number | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  useEffect(() => {
    if (playing) return;
    const id = setTimeout(() => setImgT(shownT), 220);
    return () => clearTimeout(id);
  }, [shownT, playing]);
  // 描くたびに新しい source を渡すと Web では毎回取り直して読み終わらないので、時刻が変わった時だけ作る
  const imgSrc = useMemo(() => (imgT == null ? null : { uri: api.videoActions.frameUrl(videoId, imgT, node), headers: api.client.authHeaders() }),
    [api, videoId, imgT, node]);

  const step = (d: number) => {
    pause();
    setImgLoading(true);
    if (has) {
      const i = Math.max(0, Math.min(times!.length - 1, (shownIdx ?? frameAt(times!, time)) + d));
      setShownIdx(i);
      seek(times![i]!);
    } else seek(Math.max(0, time + d / 30));   // フレーム表が無い時は 1/30 秒
  };

  return { times, has, snap, frameOf, curIdx, shownT, imgT, imgSrc, imgLoading, setImgLoading, step };
}

export type FrameStepper = ReturnType<typeof useFrameStepper>;
