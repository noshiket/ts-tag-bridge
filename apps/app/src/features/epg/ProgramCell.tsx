import { genreOf, programFlags, type EpgEvent } from '@tstag/core';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { FLAG_COLOR, cellLook, forceColor, genreStyle } from './colors';
import { trLabel, useT } from '../../ui/i18n/I18n';

/**
 * 番組表の1つの番組（元の ProgramCell）: 分・録/休・印（3つまで）・放送中なら実況の勢い、題名、
 * 高さに余裕があれば説明とジャンル。終わった番組は薄くする
 */
export const ProgramCell = memo(function ProgramCell({ e, top, height, left, width, scale = 1, status, force, now, onPress }: {
  e: EpgEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  /** 拡大縮小の倍率。中の文字も同じだけ縮める（元と同じく、中身を倍率で割った大きさで作ってから縮める） */
  scale?: number;
  status: 'rec' | 'skip' | undefined;
  force: number | undefined;
  now: number;
  onPress: (e: EpgEvent) => void;
}) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const gs = genreStyle(genreOf(e.content_nibble), theme);
  const look = cellLook(theme);
  const start = Date.parse(e.start_time);
  const end = start + e.duration_sec * 1000;
  const past = end < now;
  const airing = start <= now && now < end;
  // 行数は見た目の高さで決める（元と同じ）
  const titleLines = height < 40 ? 1 : height < 80 ? 2 : 3;
  const descLines = height < 80 ? 0 : height < 130 ? 2 : Math.floor((height - 60) / 14);
  const inner = scale === 1 ? styles.inner
    : [styles.inner, { width: (width - 4) / scale, height: height / scale, transform: [{ scale }], transformOrigin: 'top left' as const }];
  const reserved = status === 'rec';
  const skipped = status === 'skip';
  return (
    <Pressable onPress={() => onPress(e)} style={[styles.cell, {
      top, left, width: width - 4, height, backgroundColor: gs.bg, borderRadius: look.radius,
      borderWidth: reserved || skipped ? Math.max(look.border, 1.5) : look.border,
      borderColor: skipped ? theme.mute : reserved ? accent.primary : look.borderColor,
      borderStyle: skipped ? 'dashed' : 'solid',
      boxShadow: reserved ? `inset 0px 0px 0px 1.5px ${accent.primary}` : look.shadow,
    }]}>
      {!!gs.bar && <View pointerEvents="none" style={[styles.bar, { backgroundColor: gs.bar }]} />}
      <View style={inner}>
        <View style={styles.head}>
          <T mono size={10} w={800} color={gs.ink} style={styles.mm}>{String(new Date(start).getMinutes()).padStart(2, '0')}</T>
          {skipped ? <Badge bg={theme.mute}>{tx('epg.badge.skip')}</Badge> : reserved ? <Badge bg={accent.primary}>{tx('epg.badge.rec')}</Badge> : null}
          {programFlags(e).slice(0, 3).map((f) => (
            <View key={f} style={[styles.flag, { backgroundColor: FLAG_COLOR[f] }]}><T size={9} w={800} color="#fff">{f}</T></View>
          ))}
          {airing && force != null && <T mono size={9} w={800} color={forceColor(force)} style={styles.force}>{`🔥${force}`}</T>}
      </View>
      <T size={titleLines >= 2 ? 11 : 10} w={700} color={gs.ink} numberOfLines={titleLines} style={styles.title}>{e.title}</T>
      {descLines > 0 && !!e.description && <T size={9} w={500} color={gs.ink} numberOfLines={descLines} style={styles.desc}>{e.description}</T>}
      {height >= 100 && <T mono size={8} w={700} color={gs.ink} style={styles.genre}>{trLabel(tx, 'epg.genre', genreOf(e.content_nibble), { [genreOf(e.content_nibble)]: gs.label }).toUpperCase()}</T>}
      </View>
      {past && <View pointerEvents="none" style={[styles.past, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)' }]} />}
    </Pressable>
  );
});

function Badge({ children, bg }: { children: string; bg: string }) {
  return <View style={[styles.badge, { backgroundColor: bg }]}><T mono size={8} w={800} color="#fff">{children}</T></View>;
}

const styles = StyleSheet.create({
  cell: { position: 'absolute', overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  inner: { flex: 1, paddingVertical: 4, paddingHorizontal: 6, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  mm: { opacity: 0.9 },
  badge: { paddingVertical: 1, paddingHorizontal: 4, borderRadius: 3 },
  flag: { width: 13, height: 13, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  force: { marginLeft: 'auto' },
  title: { lineHeight: 13 },
  desc: { lineHeight: 12, opacity: 0.72 },
  genre: { marginTop: 'auto', opacity: 0.55, letterSpacing: 0.5 },
  past: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
