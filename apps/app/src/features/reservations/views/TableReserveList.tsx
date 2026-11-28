import { TUNER_SHORTAGE, reserveHeadline, reserveStatus, reserveTimes, type Reserve } from '@tstag/core';
import { Image } from 'expo-image';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RECORDING, TitleMarks, dayLabel, quoted, reserveAlerts, reserveNotes } from './parts';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { Trash } from '../../../ui/parts/Icons';
import { T } from '../../../ui/parts/T';
import { danger } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

type Thumb = { uri: string; headers?: Record<string, string> } | null;

/**
 * 予約一覧のテレビ欄表示（時刻の比較が主役）。新聞のテレビ欄の作法: 日ごとの帯、左に時刻の列（時を大きく、分を下に）、
 * 罫線で区切り、題名は切らずに全部、字・再・新は黒い四角。サムネは脇に小さく。録画中の行は時刻の列を赤く塗る
 */
export function TableReserveList({ items, now, thumbOf, tunerOf, onOpen, onMenu }: {
  items: Reserve[];
  now: number;
  thumbOf: (r: Reserve) => Thumb;
  tunerOf?: Map<number, string>;
  onOpen: (r: Reserve) => void;
  onMenu: (r: Reserve) => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  return (
    <View style={[styles.sheet, { borderColor: theme.frame, backgroundColor: theme.surface }]}>
      {items.map((r, i) => {
        const day = reserveTimes(r).start.slice(0, 10);
        const newDay = i === 0 || reserveTimes(items[i - 1]!).start.slice(0, 10) !== day;
        return (
          <Fragment key={r.reserve_id}>
            {newDay && (
              <View style={[styles.day, { backgroundColor: theme.ink }, i > 0 && styles.dayGap]}>
                <T size={12} w={900} color={theme.onInk} style={GOTHIC}>{r.start_time ? dayLabel(r.start_time, tx) : tx('reservations.list.noDate')}</T>
              </View>
            )}
            <Row r={r} now={now} thumb={thumbOf(r)} tuner={tunerOf?.get(r.reserve_id)} onPress={() => onOpen(r)} onMenu={() => onMenu(r)} />
          </Fragment>
        );
      })}
    </View>
  );
}

function Row({ r, now, thumb, tuner, onPress, onMenu }: { r: Reserve; now: number; thumb: Thumb; tuner?: string; onPress: () => void; onMenu: () => void }) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const status = reserveStatus(r, now);
  const recording = status === 'recording';
  const t = reserveTimes(r);
  const h = reserveHeadline(r);
  const alerts = reserveAlerts(r, status, tuner, theme, tx);
  const notes = reserveNotes(r, tuner, tx);
  // チューナーが足りず録れない予約は、時刻の列の数字を赤くし「録れない」を添える（録画中の赤い塗りとは分ける）
  const short = tuner === TUNER_SHORTAGE;
  const fg = recording ? '#fff' : short ? danger : theme.ink;
  return (
    <Pressable onPress={onPress} onLongPress={onMenu}
      style={[styles.row, { borderColor: theme.frame, backgroundColor: recording ? theme.surface : theme.bg, opacity: r.rec_enabled === 0 ? 0.55 : 1 }]}>
      <View style={[styles.time, { borderColor: theme.frame, backgroundColor: recording ? RECORDING : 'transparent' }]}>
        <Num size={30} color={fg}>{t.start.slice(11, 13)}</Num>
        <Num size={15} color={fg}>{t.start.slice(14, 16)}</Num>
        {short && <View style={[styles.cant, { backgroundColor: danger }]}><T size={9} w={900} color="#fff" style={GOTHIC}>{tx('reservations.list.cant')}</T></View>}
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <T size={11} w={700} numberOfLines={1} style={[GOTHIC, styles.shrink]}>{r.station_name}</T>
          <T size={11} dim style={GOTHIC}>{tx('unit.min', { n: t.durationMin })}</T>
          {alerts.map((a) => (
            <View key={a.label} style={[styles.alert, { backgroundColor: a.c }]}><T size={10} w={900} color={a.fg} style={GOTHIC}>{a.label.replace('● ', '')}</T></View>
          ))}
        </View>
        <T size={15} w={900} style={[GOTHIC, styles.title]}>
          {h.marks.length > 0 && <TitleMarks marks={h.marks} fill size={12} style={styles.marks} />}
          {h.marks.length > 0 ? ' ' : ''}{h.episode ? `${h.title} #${h.episode}` : h.title}
        </T>
        {!!h.sub && <T size={12} dim style={GOTHIC}>{quoted(h.sub)}</T>}
        {!!notes && <T mono size={9} dim numberOfLines={1}>{notes}</T>}
      </View>
      <View style={styles.side}>
        {thumb && <Image source={thumb} style={[styles.img, { borderColor: theme.frame }]} contentFit="cover" cachePolicy="memory-disk" />}
        <Pressable onPress={onMenu} hitSlop={6} accessibilityLabel={tx('reservations.list.menu')} style={styles.trash}>
          <Trash s={12} c={danger} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopWidth: 3, borderBottomWidth: 1 },
  day: { paddingVertical: 4, paddingHorizontal: 10 },
  dayGap: { marginTop: 10 },
  row: { flexDirection: 'row', borderTopWidth: 1, minHeight: 88 },
  time: { width: 54, alignItems: 'center', paddingTop: 8, borderRightWidth: 1 },
  body: { flex: 1, minWidth: 0, paddingVertical: 7, paddingLeft: 9, paddingRight: 4, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  alert: { paddingHorizontal: 5 },
  cant: { marginTop: 6, paddingHorizontal: 3, paddingVertical: 1 },
  title: { lineHeight: 20, letterSpacing: -0.15 },
  marks: { transform: [{ translateY: 2 }] },
  side: { width: 96, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingRight: 8, gap: 6 },
  img: { width: 88, height: 49.5, borderWidth: 1 },
  trash: { alignSelf: 'flex-end', padding: 4 },
  shrink: { flexShrink: 1 },
});
