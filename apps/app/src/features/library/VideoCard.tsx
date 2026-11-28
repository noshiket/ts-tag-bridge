import {
  commentDensity, dropScrambleCounts, formatDurationJa, formatFileSize, hasTelop, oddCodecLabel, dateTimeWithYear, dateWithYear,
  type Video,
} from '@tstag/core';
import { useApi, useWatchProgressOf } from '@tstag/core/react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { usePushState } from '../../lib/state/pushPeer';
import { More } from '../../ui/parts/Icons';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { StationLogo } from '../../ui/parts/StationLogo';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { danger } from '../../ui/theme/theme';
import { localStateOf, useLocalSaveSelect } from '../../lib/localSave/store';
import { LocalSaveActions } from './LocalSaveActions';
import { Badge } from './VideoCardBadge';
import { VideoDetailSheet } from './video-detail/VideoDetailSheet';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';
import { shadow } from '../../ui/theme/edge';
import { useT, localizeFmt } from '../../ui/i18n/I18n';

// 元の Web 版の色（oklch を16進に直したもの）
const MP4_BLUE = '#6CBAFF';      // oklch(0.78 0.16 255)
const TELOP_AMBER = '#E49E22';   // oklch(0.75 0.15 75)
const DROP_CORAL = '#FF6853';    // oklch(0.72 0.20 30)
/** コメントの勢いの段階（件数/分 20・50・80・110 で上がる） */
const DENSITY = ['', '', '#ffd60a', '#ff9f0a', '#ff6b35', '#ff2d55'];

/**
 * ライブラリのビデオカード（元の encode.jsx の VideoRow）。
 * 「…」で詳細（消す・移すなどの操作）。#カテゴリ を押すとそのカテゴリの動画へ。
 * ローカル保存の操作もここ（保存済みなら「▶ 再生」は端末の保存から。元と同じ）
 */
export function VideoCard({ video, node, albumName, contextLabel, onPlay, onMove, canMoveUp, canMoveDown, thumb }: {
  video: Video;
  node: string | null;
  /** アルバムの中では、アルバム名と同じカテゴリは冗長なので出さない */
  albumName?: string;
  /** アルバムをまたぐ一覧（ビデオ表示など）で、どのアルバム・シリーズかを出す */
  contextLabel?: string;
  onPlay: () => void;
  /** シリーズの中の並べ替え（アルバムの中で設定順の時） */
  onMove?: (dir: 'up' | 'down') => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** サムネを替える（通信の無い時の、端末に保存したサムネ） */
  thumb?: { uri: string } | null;
}) {
  useBgRenderCount('VideoCard');
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const [details, setDetails] = useState(false);
  const push = usePushState(video.id);
  // この動画が保存済みかだけを読む（ほかの保存の進み具合では描き直さない）
  const savedRec = useLocalSaveSelect((s) => localStateOf(s, video.id, node).saved);
  const saved = !!savedRec;
  const savedAt = savedRec?.cachedAt ?? null;
  const play = saved
    ? () => router.push({ pathname: '/watch/[id]', params: { id: String(video.id), local: '1', ...(node ? { node } : {}) } })
    : onPlay;
  // この動画の進み具合だけを読む（再生中の保存のたびに一覧のカードが全部描き直されないように）
  const progress = useWatchProgressOf(video.id);
  const music = video.media_kind === 'audio';
  const bad = !!video.folder_mismatch;
  const edge = bad ? danger : theme.cardFrame;
  const isMp4 = !!video.file_path && /\.(mp4|m4v)$/i.test(video.file_path);
  const codec = oddCodecLabel(video.video_codec);
  const density = commentDensity(video);
  const drops = dropScrambleCounts(video.drop_error);
  const hasIssue = !!drops && (drops.drop > 0 || drops.scramble > 0);
  const epNum = video.episode_number || '';
  const subTitle = epNum || video.episode_name ? video.episode_name || '' : video.eit_title || video.episode_name || tx('library.video.noTitle');
  const categories = (video.categories || []).filter((c) => contextLabel || c.name !== albumName);
  const meta = music
    ? [localizeFmt(formatDurationJa(video.duration_sec)), video.eit_start_time, video.eit_audio_info]
    : [dateTimeWithYear(video.recording_start_time || video.created_at), localizeFmt(formatDurationJa(video.duration_sec))];

  return (
    <>
    <VideoDetailSheet video={video} node={node} title={subTitle || video.eit_title || ''} open={details} onClose={() => setDetails(false)}
      onMove={onMove} canMoveUp={canMoveUp} canMoveDown={canMoveDown} />
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: bad ? danger : theme.line, boxShadow: shadow(theme, 2, edge) }]}>
      {/* どのカードも同じ高さ: 上の段（サムネと4行）は高さを決め、各行は折り返さない。フォルダ・ファイル名は … の詳細で見る */}
      <View style={styles.row}>
        <ReelThumb hue={hueFromId(video.id)} width={160} height={90}
          source={thumb !== undefined ? thumb : video.thumbnail_path ? { uri: `${api.library.videoThumbnailUrl(video.id, node)}?v=${encodeURIComponent(video.updated_at ?? '')}`, headers: api.client.authHeaders() } : null}>
          {/* 見た所まで赤い線（元と同じ） */}
          {progress > 0.01 && (
            <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
          )}
        </ReelThumb>
        <View style={styles.body}>
          <View style={styles.badges}>
            {isMp4 && !music && <Badge bg={MP4_BLUE} fg="#fff" bold>MP4</Badge>}
            {music && video.artist ? <Badge bg={theme.surface2} fg={theme.mute}>{`♪ ${video.artist}`}</Badge> : null}
            {codec && <Badge bg="rgba(223,0,13,0.15)" fg={danger} bold>{codec}</Badge>}
            {!music && video.has_caption === 1 && <Badge bg={theme.surface2} fg={theme.mute}>{tx('library.video.cc')}</Badge>}
            {!music && video.has_added_caption === 1 && <Badge bg={theme.surface2} fg={accent.primary} bold>{tx('library.video.ccAdded')}</Badge>}
            {!music && video.added_comment_tracks > 0 && <Badge bg={theme.surface2} fg={accent.primary} bold>{tx('library.video.danmakuAdded')}</Badge>}
            {!music && video.has_secondary_audio === 1 && <Badge bg={theme.surface2} fg={theme.mute}>{tx('library.video.sap')}</Badge>}
            {!music && density.perMin != null && (
              <T size={9} w={800} color={DENSITY[density.level] || theme.mute}>{`🔥${density.count.toLocaleString()} / ${density.perMin}${tx('unit.perMin')}`}</T>
            )}
            {!music && drops && (
              <Badge bg={hasIssue ? DROP_CORAL : theme.surface2} fg={hasIssue ? '#fff' : theme.mute} bold>{`drop ${drops.drop} / scr ${drops.scramble}`}</Badge>
            )}
            {!music && hasTelop(video.announce) && <Badge bg={TELOP_AMBER} fg="#000" bold>{`⚠${video.announce}`}</Badge>}
            {!!video.allow_duplicate && <Badge bg={accent.primary} fg="#fff" bold>{tx('library.video.allowDup')}</Badge>}
          </View>
          {/* 題名: 一番大きく。1行でも2行分の高さを取る。アルバムをまたぐ一覧（勢い・カテゴリなど）では
              1行目にどのアルバム・シリーズか、2行目に話数と題名（高さは同じ） */}
          <View style={styles.titleBox}>
            {contextLabel ? <T size={12} w={800} color={accent.secondary} numberOfLines={1}>{contextLabel}</T> : null}
            <View style={styles.epRow}>
              {epNum ? (
                <View style={[styles.epNum, { backgroundColor: accent.primary }]}>
                  <T mono w={800} size={contextLabel ? 11 : 13} color="#fff">{epNum}</T>
                </View>
              ) : null}
              <T size={contextLabel ? 14 : 15} w={800} numberOfLines={contextLabel ? 1 : 2} style={styles.title}>{subTitle}</T>
            </View>
          </View>
          <View style={styles.stationRow}>
            {video.onid != null && video.sid != null && !music ? (
              <StationLogo onid={video.onid} sid={video.sid} name={video.eit_station_name} />
            ) : video.eit_station_name ? (
              <T size={11} dim>{video.eit_station_name}</T>
            ) : null}
            <T size={11} dim numberOfLines={1} style={styles.shrink}>{meta.filter(Boolean).join(' · ')}</T>
          </View>
          <View style={styles.cats}>
            {categories.map((c) => (
              <Pressable key={c.id} onPress={() => router.push({ pathname: '/category/[id]', params: { id: String(c.id) } })}
                style={[styles.cat, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <T mono w={700} size={9} color={accent.secondary} numberOfLines={1}>{`#${c.name}`}</T>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      {/* 下の段（カードの幅いっぱい）: ファイルの大きさ（保存済みなら保存した日）/ 分類エラー と、保存・再生・詳細 */}
      <View style={styles.actions}>
        {bad ? <T mono size={9} w={800} color={danger} numberOfLines={1} style={styles.grow}>{tx('library.video.misfiled', { folder: video.folder ?? '' })}</T>
          : <T size={9} dim numberOfLines={1} style={styles.grow}>
              {/* 端末に保存してあれば大きさの代わりに保存した日（幅が狭いので短く） */}
              {[savedAt ? tx('library.video.savedAt', { date: dateWithYear(savedAt) }) : music ? null : formatFileSize(video.file_size)].filter(Boolean).join(' · ')}
            </T>}
        {/* 連携先へ移している間は再生・詳細の代わりに状態を出す（元と同じ） */}
        {push?.status === 'queued' ? <T mono size={10} w={700} dim>{tx('library.video.pushQueued')}</T>
          : push?.status === 'moving' ? <T mono size={10} w={700} color={accent.tertiary}>{tx('library.video.pushMoving')}</T>
          : push?.status === 'error' ? <T mono size={9} color={danger} numberOfLines={1}>{tx('library.video.pushFailed', { error: push.error ?? '' })}</T>
          : (
            <>
              {/* 保存の操作は残りの幅に収める（▶ 再生と … は必ず見せる） */}
              <View style={styles.saveActions}>
                <LocalSaveActions video={video} node={node} series={albumName ?? contextLabel ?? ''} />
              </View>
              <Pressable onPress={play} accessibilityLabel={tx(saved ? 'library.video.playLocal' : 'library.video.playA11y')} style={[styles.btn, { backgroundColor: accent.primary }]}>
                <T mono w={700} size={10} color="#fff">{tx('library.video.play')}</T>
              </Pressable>
              <Pressable onPress={() => setDetails(true)} accessibilityLabel={tx('library.video.details')} style={[styles.more, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <More s={14} c={theme.ink} />
              </Pressable>
            </>
          )}
      </View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  progress: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.35)' },
  progressFill: { height: '100%', backgroundColor: '#e53e3e' },
  card: { borderWidth: 1, borderRadius: 11, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, paddingTop: 10, paddingHorizontal: 10, height: 100 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 16, overflow: 'hidden' },
  titleBox: { height: 38, minWidth: 0 },
  epRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 },
  epNum: { borderRadius: 5, paddingVertical: 1, paddingHorizontal: 7 },
  title: { flex: 1, lineHeight: 19 },
  shrink: { flexShrink: 1 },
  stationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cats: { flexDirection: 'row', gap: 4, height: 18, overflow: 'hidden' },
  cat: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 8, borderWidth: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, height: 44 },
  saveActions: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, overflow: 'hidden' },
  btn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6, flexShrink: 0 },
  more: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  grow: { flex: 1 },
});
