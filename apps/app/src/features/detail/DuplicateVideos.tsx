import { videoContextLabel, type DuplicateVideo, type Video } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQueries } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../ui/parts/SectionTitle';
import { VideoCard } from '../library/VideoCard';
import { DuplicateRow } from './DuplicateRow';
import { useT } from '../../ui/i18n/I18n';

/**
 * その動画があるサーバー。origin_peer は「録画のサーバーが連携先で見つけた動画」で、録画のサーバーから見た相手にある。
 * 録画が別のサーバー（node）の物なら相手はこのサーバー、このサーバーの録画なら相手は origin_peer
 */
const videoNodeOf = (d: DuplicateVideo, node: string | null) => (d.origin_peer ? (node ? null : d.origin_peer) : node);

/**
 * 既存の動画との重複（確定値のフォルダ・題名・話数が一致した動画）。予約・録画の詳細の一番下（元と同じ）。
 * アルバムと同じビデオカードで出す（そのシリーズの動画一覧から引く）。引けない時は照合で分かった分だけの短い行
 */
export function DuplicateVideos({ list, node }: { list: DuplicateVideo[]; node: string | null }) {
  const { t: tx } = useT();
  const api = useApi();
  const groups = [...new Map(list.filter((d) => d.series_id != null)
    .map((d) => { const vn = videoNodeOf(d, node); return [`${vn ?? ''}:${d.series_id}`, { vn, sid: d.series_id! }] as const; })).values()];
  const series = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['seriesVideos', g.vn ?? '', g.sid],
      queryFn: () => api.library.series(g.sid, g.vn),
      retry: false,
    })),
  });
  if (!list.length) return null;
  const videoOf = (d: DuplicateVideo, vn: string | null): Video | undefined => {
    const i = groups.findIndex((g) => g.vn === vn && g.sid === d.series_id);
    return i < 0 ? undefined : series[i]?.data?.videos.find((v) => v.id === d.id);
  };
  return (
    <View style={styles.wrap}>
      <SectionTitle>{tx('detail.duplicateVideos.videosLibrary')}</SectionTitle>
      <View style={styles.list}>
        {list.map((d) => {
          const vn = videoNodeOf(d, node);
          const play = () => router.push({ pathname: '/watch/[id]', params: { id: String(d.id), ...(vn ? { node: vn } : {}) } });
          const v = videoOf(d, vn);
          return v
            ? <VideoCard key={`${vn ?? ''}:${d.id}`} video={v} node={vn} contextLabel={videoContextLabel({ album_name: d.album, series_name: d.series })} onPlay={play} />
            : <DuplicateRow key={`${vn ?? ''}:${d.id}`} d={d} videoNode={vn} onPlay={play} />;
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  list: { gap: 8 },
});
