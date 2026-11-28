import { endMs, genreOf, programFlags, programStatus, type EpgEvent, type reserveMaps } from '@tstag/core';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chev } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { FLAG_COLOR, bandColor, forceColor, genreStyle } from './colors';
import { shadow } from '../../ui/theme/edge';
import { trLabel, useT } from '../../ui/i18n/I18n';

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * 番組表の List（元の EpgList）: 選んでいる局のその日の番組を、朝4時からの時ごとにまとめて並べる。
 * 予約は枠の色（スキップは点線）、終わった番組は薄く
 */
export function EpgList({ events, short, hue, now, maps, forces, onPress }: {
  events: EpgEvent[];
  short: string;
  hue: number;
  now: number;
  maps: ReturnType<typeof reserveMaps>;
  forces: Record<string, number> | undefined;
  onPress: (e: EpgEvent) => void;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const byHour = new Map<number, EpgEvent[]>();
  for (const e of [...events].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))) {
    const h = new Date(e.start_time).getHours();
    byHour.set(h, [...(byHour.get(h) ?? []), e]);
  }
  const hours = [...byHour.keys()].sort((a, b) => ((a - 4 + 24) % 24) - ((b - 4 + 24) % 24));
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      {hours.map((h) => (
        <View key={h}>
          <View style={styles.hourHead}>
            <T mono size={22} w={800} style={styles.hourNum}>{String(h).padStart(2, '0')}</T>
            <T mono size={10} dim>{`:00 — ${byHour.get(h)!.length} programs`}</T>
          </View>
          <View style={styles.list}>
            {byHour.get(h)!.map((e) => {
              const st = programStatus(maps, e);
              const gs = genreStyle(genreOf(e.content_nibble), theme);
              const start = Date.parse(e.start_time);
              const airing = start <= now && now <= endMs(e);
              const force = forces?.[`${e.onid}-${e.sid}`];
              const edge = st === 'skip' ? theme.mute : st === 'rec' ? accent.primary : theme.cardFrame;
              return (
                <Pressable key={`${e.sid}-${e.event_id}`} onPress={() => onPress(e)} style={[styles.row, {
                  backgroundColor: theme.surface, borderColor: edge, borderStyle: st === 'skip' ? 'dashed' : 'solid',
                  boxShadow: shadow(theme, 2, edge), opacity: endMs(e) < now ? 0.4 : 1,
                }]}>
                  <View style={[styles.bar, { backgroundColor: bandColor(hue, theme) }]} />
                  <View style={styles.body}>
                    <View style={styles.badges}>
                      <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={9} w={700}>{short}</T></View>
                      <T mono size={9} dim>{`${hm(start)} · ${tx('unit.min', { n: Math.round(e.duration_sec / 60) })}`}</T>
                      <View style={[styles.tag, { backgroundColor: gs.bg }]}><T size={8} w={700} color={gs.ink}>{trLabel(tx, 'epg.genre', genreOf(e.content_nibble), { [genreOf(e.content_nibble)]: gs.label })}</T></View>
                      {st === 'skip' ? <View style={[styles.tag, { backgroundColor: theme.mute }]}><T mono size={8} w={800} color="#fff">SKIP</T></View>
                        : st === 'rec' ? <View style={[styles.tag, { backgroundColor: accent.primary }]}><T mono size={8} w={800} color="#fff">REC</T></View> : null}
                      {programFlags(e).map((f) => (
                        <View key={f} style={[styles.flag, { backgroundColor: FLAG_COLOR[f] }]}><T size={9} w={800} color="#fff">{f}</T></View>
                      ))}
                      {airing && force != null && <T mono size={9} w={800} color={forceColor(force)}>{`🔥${force}`}</T>}
                    </View>
                    <T size={12} w={700}>{e.title}</T>
                    {!!e.description && <T size={10} dim numberOfLines={2} style={styles.desc}>{e.description}</T>}
                  </View>
                  <Chev c={theme.mute} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, gap: 14, paddingBottom: 40 },
  hourHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  hourNum: { letterSpacing: -0.5 },
  list: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1.5 },
  bar: { width: 4, height: 44, borderRadius: 2 },
  body: { flex: 1, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 3 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  flag: { width: 13, height: 13, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  desc: { marginTop: 3, lineHeight: 14 },
});
