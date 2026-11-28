import { adjacentEpisode, type StreamMeta } from '@tstag/core';
import { useSeries } from '@tstag/core/react';
import { useMemo } from 'react';

import { localItems, localStateOf, useLocalSaveSelect } from '../../lib/localSave/store';
import { useMusicQueue } from '../../lib/playback/musicQueue';
import type { WatchParams } from '../../lib/playback/miniPlayer';

/**
 * 隣の話数・曲へ（元と同じ）。次は頭から、前は続きから。
 * 音楽の再生の並び（アルバム・プレイリスト・シャッフル）に今の曲があればその並びで、無ければ同じシリーズの並びで送る。
 * 通信が無くて話数の並びが取れない時（飛行機の中など）は、端末に保存した同じアルバムの分を放送の順に並べて使う
 */
export function useEpisodeNav({ meta, videoId, node, rec, open }: {
  meta: StreamMeta | undefined;
  videoId: number;
  node: string | null;
  rec: boolean;
  /** 開く（サーバー・端末の保存のどちらから流すかは呼ぶ側が決める） */
  open: (p: Omit<WatchParams, 'node'>) => void;
}) {
  const queue = useMusicQueue();
  const series = useSeries(meta?.series_id ?? 0, node, meta?.series_id != null);
  // 保存済みの一覧だけを読む（保存の進み具合で再生画面を丸ごと描き直さない。描き直すと保存中の再生で操作が効かなくなった）
  const localIndex = useLocalSaveSelect((s) => s.index);
  const offlineEpisodes = useMemo(() => {
    if (rec || series.data) return null;
    const localSnap = { ready: true, index: localIndex, states: {} };
    const me = localStateOf(localSnap, videoId, node).saved;
    if (!me?.series) return null;
    const when = (it: { eitStartTime?: string; recStart?: string }) => it.eitStartTime || it.recStart || '';
    const list = localItems(localSnap, node).filter((it) => it.series === me.series)
      .sort((a, b) => when(a).localeCompare(when(b)) || (parseFloat(a.episodeNum ?? '') || 0) - (parseFloat(b.episodeNum ?? '') || 0));
    return list.length > 1 ? list : null;
  }, [rec, series.data, localIndex, videoId, node]);

  const goEpisode = (direction: 1 | -1) => {
    if (rec) return;   // 録画に隣の話数は無い
    if (queue.has(videoId)) {
      // 並びの端では止まる
      const next = queue.adjacent(videoId, direction);
      if (next != null) open({ id: String(next), ...(direction > 0 ? { from: 'start' } : {}) });
      return;
    }
    const target = series.data ? adjacentEpisode(series.data.videos, videoId, direction)
      : offlineEpisodes ? offlineEpisodes[offlineEpisodes.findIndex((it) => it.id === videoId) + direction] : null;
    if (!target) return;
    open({ id: String(target.id), ...(direction > 0 ? { from: 'start' } : {}) });
  };
  const canNext = !rec && (queue.has(videoId) || (series.data?.videos.length ?? 0) > 1 || !!offlineEpisodes);
  return { series, queue, goEpisode, canNext };
}
