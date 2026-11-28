import { nodePath, type StreamMeta } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useRef, type RefObject } from 'react';

import type { VideoSurfaceHandle } from '../surface';
import { miniPlayer } from '../../../lib/playback/miniPlayer';

/** 下のミニプレイヤーへ状態と操作を渡す。操作は最新のものを呼ぶ（渡した時のままにしない）。画面を外れたら消す */
export function useWatchMiniPlayer({ meta, title, rec, videoId, node, posterUri, playing, canNext, surface, next }: {
  meta: StreamMeta | undefined; title: string; rec: boolean; videoId: number; node: string | null; posterUri: string | null | undefined;
  playing: boolean; canNext: boolean; surface: RefObject<VideoSurfaceHandle | null>; next: () => void;
}) {
  const api = useApi();
  const actions = useRef({ toggle: () => {}, next: () => {} });
  actions.current = {
    toggle: () => { if (playing) surface.current?.pause(); else surface.current?.play(); },
    next,
  };
  useEffect(() => {
    miniPlayer.publish({
      kind: 'watch',
      title: meta?.series_name || title,
      episodeNum: meta?.episode_number ? String(meta.episode_number) : '',
      episodeName: meta?.episode_name || meta?.title || '',
      thumb: posterUri ? { uri: posterUri }
        : { uri: api.client.url(nodePath(node, rec ? `/api/encode/recordings/${videoId}/thumbnail` : `/api/videos/${videoId}/thumbnail`)), headers: api.client.authHeaders() },
      playing, canNext,
      toggle: () => actions.current.toggle(),
      next: () => actions.current.next(),
    });
  }, [meta, title, rec, videoId, node, playing, canNext]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => miniPlayer.clear('watch'), []);
}
