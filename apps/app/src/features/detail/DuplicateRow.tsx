import { commentsPerMin, hasTelop, type DuplicateVideo } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const heat = (pm: number | null, mute: string) =>
  pm == null ? mute : pm >= 110 ? '#ff2d55' : pm >= 80 ? '#ff6b35' : pm >= 50 ? '#ff9f0a' : pm >= 20 ? '#ffd60a' : mute;

/**
 * 重複の動画の短い行。ビデオカード（DuplicateVideos）に要る動画の情報が取れない時（相手のサーバーに
 * つながらない・古いサーバーで series_id が来ない）に、照合で分かった分だけで出す
 */
export function DuplicateRow({ d, videoNode, onPlay }: { d: DuplicateVideo; videoNode: string | null; onPlay: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const pm = commentsPerMin(d.comment_count, d.duration_sec);
  const thumb = api.library.videoThumbnailUrl(d.id, videoNode);
  return (
    <Pressable onPress={onPlay}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <Image source={{ uri: thumb, headers: api.client.authHeaders() }} style={[styles.thumb, { borderColor: theme.line }]} contentFit="cover" />
      <View style={styles.body}>
        <View style={styles.title}>
          <T size={12} w={700} numberOfLines={1} style={styles.shrink}>{d.series || d.album || ''}</T>
          {d.episode_number != null && d.episode_number !== '' && (
            <View style={[styles.ep, { backgroundColor: accent.tertiary }]}><T mono size={10} w={700} color="#fff">{`#${d.episode_number}`}</T></View>
          )}
        </View>
        {!!d.episode_name && <T mono size={9} dim numberOfLines={1} style={styles.gap}>{d.episode_name}</T>}
        <T mono size={9} dim style={styles.gap}>
          {`📼 ${d.eit_station_name || tx('recresult.rec.unknownStation')}`}
          {pm != null && <T mono size={9} w={800} color={heat(pm, theme.mute)}>{tx('detail.duplicateRow.heatPerMin', { v0: pm })}</T>}
          {d.has_issue && <T mono size={9} w={800} color={oklch(0.6, 0.22, 25)}>{` ⚠ drop ${d.drop_count || 0} / scr ${d.scramble_count || 0}`}</T>}
          {hasTelop(d.announce) && <T mono size={9} w={800} color={oklch(0.65, 0.2, 55)}> {tx('detail.duplicateRow.hasAnnouncement')}</T>}
        </T>
      </View>
      <T mono size={9} dim>{tx('detail.duplicateRow.play')}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 12 },
  thumb: { width: 80, height: 45, borderRadius: 6, borderWidth: 1 },
  body: { flex: 1, minWidth: 0 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  ep: { paddingHorizontal: 5, borderRadius: 3 },
  gap: { marginTop: 2 },
});
