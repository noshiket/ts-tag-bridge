import { recordingProgress, reserveHeadline, reserveStatus, reserveTimes, type Reserve } from '@tstag/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RECORDING, TitleMarks, quoted, reserveAlerts, reserveNotes } from './parts';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { Trash } from '../../../ui/parts/Icons';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { StationLogo } from '../../../ui/parts/StationLogo';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { danger } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 予約一覧のテロップ表示（サムネと題名が主役）。放送のテロップの作法: サムネの下端に時刻（大きく一段太い数字）と局の帯を重ね、
 * 話数は隅に大きく、題名はゴシックの極太、サブタイトルは細字の「」。録画中・不足などは左上の帯
 */
export function PosterReserveCard({ r, now, thumb, tuner, onPress, onMenu }: {
  r: Reserve;
  now: number;
  thumb: { uri: string; headers?: Record<string, string> } | null;
  tuner?: string;
  onPress?: () => void;
  onMenu?: () => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const [imgErr, setImgErr] = useState(false);
  const status = reserveStatus(r, now);
  const t = reserveTimes(r);
  const h = reserveHeadline(r);
  const alerts = reserveAlerts(r, status, tuner, theme, tx);
  const notes = reserveNotes(r, tuner, tx);
  const recording = status === 'recording';
  return (
    <Pressable onPress={onPress} onLongPress={onMenu} disabled={!onPress}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardFrame, opacity: r.rec_enabled === 0 ? 0.55 : 1 }]}>
      <View style={styles.img}>
        {thumb && !imgErr
          ? <Image source={thumb} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" onError={() => setImgErr(true)} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.55, 0.16, hueFromId(r.reserve_id)) }]} />}
        {alerts.length > 0 && (
          <View style={styles.telops}>
            {alerts.map((a) => <View key={a.label} style={[styles.telop, { backgroundColor: a.c }]}><T size={12} w={900} color={a.fg} style={GOTHIC}>{a.label}</T></View>)}
          </View>
        )}
        {!!h.episode && <Num size={30} color="#fff" style={styles.ep}>{`#${h.episode.padStart(2, '0')}`}</Num>}
      </View>
      <View style={styles.super}>
        <View style={[styles.time, { backgroundColor: recording ? RECORDING : theme.ink }]}>
          <Num size={24} color={recording ? '#fff' : theme.onInk}>{t.start.slice(11)}</Num>
          <Num size={14} color={recording ? '#fff' : theme.onInk} style={styles.end}>{`–${t.end.slice(11)}`}</Num>
        </View>
        <View style={[styles.station, { backgroundColor: theme.surface, borderColor: theme.ink }]}>
          <StationLogo onid={r.onid} sid={r.sid} height={12} maxWidth={22} />
          <T size={12} w={700} numberOfLines={1} style={[GOTHIC, styles.shrink]}>{r.station_name}</T>
        </View>
        <Num size={13} color={theme.mute} style={styles.date}>{`${t.start.slice(5, 10).replace('-', '/')} ${tx('unit.min', { n: t.durationMin })}`}</Num>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <T size={19} w={900} numberOfLines={2} style={[GOTHIC, styles.title]}>{h.title}</T>
          <TitleMarks marks={h.marks} style={styles.marks} />
        </View>
        {!!h.sub && <T size={14} dim numberOfLines={1} style={GOTHIC}>{quoted(h.sub)}</T>}
        <View style={styles.foot}>
          <T mono size={9} dim numberOfLines={1} style={styles.shrink}>{notes}</T>
          {onMenu && (
            <Pressable onPress={onMenu} hitSlop={6} accessibilityLabel={tx('reservations.list.menu')} style={[styles.trash, { borderColor: theme.line }]}>
              <Trash s={12} c={danger} />
            </Pressable>
          )}
        </View>
      </View>
      {recording && (
        <View style={[styles.bar, { backgroundColor: theme.surface2 }]}>
          <View style={{ width: `${recordingProgress(r, now) * 100}%`, height: '100%', backgroundColor: RECORDING }} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  img: { aspectRatio: 16 / 9, backgroundColor: '#000' },
  telops: { position: 'absolute', left: 0, top: 10, gap: 3, alignItems: 'flex-start' },
  telop: { paddingVertical: 3, paddingLeft: 8, paddingRight: 10 },
  ep: { position: 'absolute', right: 10, bottom: 22, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
  super: { flexDirection: 'row', alignItems: 'stretch', marginTop: -18, paddingHorizontal: 10 },
  time: { flexDirection: 'row', alignItems: 'baseline', paddingTop: 6, paddingBottom: 5, paddingHorizontal: 10 },
  end: { marginLeft: 2, opacity: 0.85 },
  station: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderWidth: 2, borderLeftWidth: 0, flexShrink: 1, minWidth: 0 },
  date: { marginLeft: 'auto', alignSelf: 'flex-end', paddingLeft: 8 },
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  title: { flexShrink: 1, lineHeight: 25 },
  marks: { marginTop: 5 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, marginTop: 4 },
  shrink: { flexShrink: 1, minWidth: 0 },
  trash: { marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 4 },
});
