import { nodePath, type StreamMeta } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { localSave } from '../../../lib/localSave/store';

/** 操作の表示を消すまでの時間（再生中だけ） */
const HIDE_MS = 3000;

/** 操作の表示: 触ると出て、再生中なら少しして消える。hold はシークバーを触っている間（消さない） */
export function useControlsVisibility(playing: boolean) {
  const [visible, setVisible] = useState(true);
  const hold = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!hold.current) setVisible(false); }, HIDE_MS);
  }, []);
  useEffect(() => { if (!playing) setVisible(true); else bump(); }, [playing, bump]);
  return { visible, setVisible, bump, hold };
}

/** 再生画面を離れる時: 確定値を直していれば、そのフォルダ・パスへファイルを動かす（直していなければサーバーは何もしない。録画は動かさない。元と同じ） */
export function useRelocateOnLeave(videoId: number, node: string | null, rec: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  useEffect(() => () => {
    if (rec) return;
    api.videoActions.relocate(videoId, node).then((r) => {
      // 番号が変わったら、この端末の保存も付け替える（元と同じ）
      localSave.afterRelocate(r, videoId, node);
      if (r?.relocated || r?.updated) void qc.invalidateQueries({ queryKey: ['library'] });
    }).catch(() => {});
  }, [videoId, node, rec]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * 音だけで聴く（音楽・画質「音声のみ」）: 小窓にせず、ロック画面に曲名と操作を出す。
 * ジャケットは端末の保存にあればそれ、無ければ音楽は曲のジャケット原本（正方形。無ければサーバーがサムネを返す）、動画はサムネ。
 * 音楽のサムネは 16:9（中央にジャケット・左右はぼかし）なので使わない
 */
export function useAudioMode({ isMusic, audioOnly, title, meta, posterUri, rec, videoId, node }: {
  isMusic: boolean; audioOnly: boolean; title: string; meta: StreamMeta | undefined; posterUri: string | null | undefined; rec: boolean; videoId: number; node: string | null;
}) {
  const api = useApi();
  return useMemo(() => {
    if (!isMusic && !audioOnly) return null;
    const art = api.client.url(nodePath(node, rec ? `/api/encode/recordings/${videoId}/thumbnail`
      : isMusic ? `/api/videos/${videoId}/cover?fallback=1` : `/api/videos/${videoId}/thumbnail`));
    return {
      title: (isMusic ? meta?.title : title) || title,
      artist: isMusic ? meta?.artist || undefined : meta?.series_name || undefined,
      artwork: posterUri ?? undefined,
      artworkSource: { uri: art, headers: api.client.authHeaders() },
    };
  }, [isMusic, audioOnly, title, meta?.title, meta?.artist, meta?.series_name, posterUri, rec, videoId, node, api]);
}

/** 画面に出す題名。音楽は同じプレイヤーのまま曲が替わるので、曲名 / アーティストを出す（元と同じ） */
export const watchTitle = (meta: StreamMeta | undefined) => (!meta ? '' : meta.media_kind === 'audio' ? [meta.title, meta.artist].filter(Boolean).join(' / ')
  : [meta.series_name, meta.episode_number ? `#${meta.episode_number}` : '', meta.episode_name].filter(Boolean).join(' ') || meta.title);
