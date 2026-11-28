import { clockLabel, fileSizeLabel, recordingTimes, type RecordingDetail } from '@tstag/core';
import { useApi, useRecordingProbe } from '@tstag/core/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { REC_OK, REC_PROTECT, REC_RED, REC_STATE_COLOR } from './recColors';
import { Card, Tag } from '../detail/Card';
import { MetaGrid, MetaRow } from '../detail/MetaRow';
import { Tv } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { StationLogo } from '../../ui/parts/StationLogo';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** 録画の見出しのカード: サムネ・印・番組名（EPG と違えば EDCB の名前も）・ファイルとドロップ・録画再生・番組と録画の値 */
export function RecordingHeaderCard({ r, node }: { r: RecordingDetail; node: string | null }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const dbRecId = r.db_rec_id!;
  const v = useRecordingProbe(dbRecId, node).data?.video;
  const t = recordingTimes(r);
  const issue = r.drops > 0 || r.scrambles > 0;
  // 勢い: 再生時間から（無ければ録画の開始〜終了から）
  const durMin = r.duration_sec != null ? r.duration_sec / 60
    : r.recording_start_time && r.recording_end_time ? (Date.parse(r.recording_end_time) - Date.parse(r.recording_start_time)) / 60000 : null;
  const recTime = (s: string | null | undefined) => (s ? s.replace('T', ' ').slice(0, 23) : '');
  return (
    <Card>
      <View style={styles.headRow}>
        <Image source={{ uri: api.recordings.thumbnailUrl(dbRecId, node), headers: api.client.authHeaders() }}
          style={[styles.thumb, { borderColor: theme.line }]} contentFit="cover" />
        <View style={styles.grow}>
          <View style={styles.badges}>
            <Tag bg={theme.ink} fg={theme.onInk}>{`rec:${r.id}`}</Tag>
            <Tag bg={theme.surface2} fg={theme.mute}>{`id:${r.id}`}</Tag>
            {r.protect_flag && <Tag bg={REC_PROTECT} fg="#fff">PROTECT</Tag>}
            {issue && <Tag bg={oklch(0.72, 0.2, 30)} fg="#fff">ISSUES</Tag>}
          </View>
          <T range size={15} w={700} style={styles.title}>{r.title}</T>
          {/* 予約（EDCB の EPG）の番組名が TS の番組名と違った時だけ（予約時の EPG が暫定だった・全角半角が違った） */}
          {!!r.edcb_title && r.edcb_title !== r.title && (
            <T range size={10} dim style={styles.edcb}><T mono size={8} w={700} dim>EDCB </T>{r.edcb_title}</T>
          )}
        </View>
      </View>
      <View style={[styles.file, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.05)' }]}>
        <T mono size={9} dim style={styles.ls}>FILE PATH</T>
        <T range mono size={10} w={700} color={accent.tertiary}>{r.rec_file_path}</T>
        <View style={styles.fileRow}>
          <T mono size={10} w={700} color={r.drops > 0 ? REC_RED : REC_OK}>{`drops: ${r.drops}`}</T>
          <T mono size={10} w={700} color={r.scrambles > 0 ? REC_RED : REC_OK}>{`scrambles: ${r.scrambles}`}</T>
          {!!r.comment && <T range mono size={10} w={500} color={oklch(0.55, 0.15, 60)}>{`⚑ ${r.comment}`}</T>}
        </View>
        {/* 録画の TS をそのまま再生する（元の「録画再生 / WATCH」） */}
        <Pressable onPress={() => router.push({ pathname: '/watch/[id]', params: { id: dbRecId, kind: 'rec' } })}
          style={[styles.watch, { backgroundColor: oklch(0.48, 0.18, 145), borderColor: oklch(0.35, 0.18, 145), boxShadow: shadow(theme, 3, oklch(0.35, 0.18, 145)) }]}>
          <Tv s={16} c="#fff" /><T size={13} w={800} color="#fff">{tx('recordingDetail.recordingHeaderCard.watchRecording')}</T>
        </Pressable>
      </View>
      <MetaGrid>
        <MetaRow label={tx('common.station')} value={r.service_name} logo={<StationLogo onid={r.onid} sid={r.sid} height={20} maxWidth={36} />} />
        <MetaRow label={tx('common.genre')} value={r.eit_genre} />
        <MetaRow label={tx('common.start2')} value={t.start} />
        <MetaRow label={tx('common.end')} value={t.end} />
        <MetaRow label={tx('common.duration')} value={t.durationMin ? tx('common.min', { v0: t.durationMin }) : ''} />
        <MetaRow label={tx('recordingDetail.recordingHeaderCard.size')} value={fileSizeLabel(r.file_size)} />
        <MetaRow label={tx('epg.video')} value={r.eit_video_info} />
        <MetaRow label={tx('epg.audio')} value={r.eit_audio_info} />
        <MetaRow label={tx('recordingDetail.recordingHeaderCard.recStart')} value={recTime(r.recording_start_time)} />
        <MetaRow label={tx('recordingDetail.recordingHeaderCard.recEnd')} value={recTime(r.recording_end_time)} />
        {r.duration_sec != null && <MetaRow label={tx('recordingDetail.recordingHeaderCard.totalLength')} value={clockLabel(r.duration_sec)} />}
        {r.eit_overlap != null && <MetaRow label={tx('recordingDetail.recordingHeaderCard.match')} value={`${(r.eit_overlap * 100).toFixed(1)}%`} />}
        {r.comment_count != null && (
          <MetaRow label={tx('common.comments2')} value={`${tx('recresult.rec.comments', { n: r.comment_count.toLocaleString() })}${durMin ? ` / ${(r.comment_count / durMin).toFixed(1)} ${tx('unit.perMin')}` : ''}`} />
        )}
        {!!r.state && (
          <MetaRow label="DB STATE" value={<T mono size={10} w={800} color={REC_STATE_COLOR[r.state] ?? theme.mute}>{r.state}</T>} />
        )}
        {!!r.edcb_tag && <MetaRow label="EDCB TAG" value={r.edcb_tag} />}
        {v && <MetaRow label={tx('recordingDetail.recordingHeaderCard.resolution')} value={`${v.width}×${v.height}`} />}
        {v && <MetaRow label={tx('recordingDetail.recordingHeaderCard.codec')} value={`${v.codec} / ${v.fps}fps`} />}
      </MetaGrid>
    </Card>
  );
}

const styles = StyleSheet.create({
  watch: { marginTop: 10, padding: 11, borderRadius: 12, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headRow: { flexDirection: 'row', gap: 11, marginBottom: 10 },
  thumb: { width: 96, height: 54, borderRadius: 10, borderWidth: 1, alignSelf: 'center' },
  grow: { flex: 1, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 4 },
  title: { lineHeight: 19 },
  edcb: { marginTop: 3, lineHeight: 14 },
  file: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 10 },
  ls: { letterSpacing: 0.5, marginBottom: 4 },
  fileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
});
