import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Label, SmallBtn } from './configFields';
import type { ConfigEditorState } from './useConfigEditor';
import { MINI_FULL, MINI_MAX, isMiniFull, miniBarHeight, miniFullVideoWidth, miniRowThumb } from '../../../lib/playback/miniPlayer';
import { VerticalTitle } from '../../shell/VerticalTitle';
import { Slider } from '../../../ui/inputs/Slider';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const K = 'mini_player_height';
const DEFAULT = 64;
/** つまみの一番右（上限の次）は「横幅いっぱい」 */
const FULL_STOP = MINI_MAX + 4;

/**
 * ミニプレイヤーの高さ（40〜200px と、一番右の「横幅いっぱい」）。つまみで決め、その帯の見本を下に出す
 * （中身の大きさは本物と同じ決め方）。空欄は既定の 64。保存すると、このサーバーにつないでいる端末の帯が変わる
 */
export function MiniHeightRow({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const SAMPLE = tx('settings.miniHeightRow.starFragments03First');
  const { theme, accent } = useTheme();
  const raw = c.val(K);
  const blank = raw === '' || raw == null;
  const full = !blank && isMiniFull(raw);
  const h = miniBarHeight(blank ? DEFAULT : raw);
  const [boxW, setBoxW] = useState(0);
  const row = miniRowThumb(h, boxW);
  const thumbW = full ? miniFullVideoWidth(boxW - 22) : row.w;
  const thumbH = full ? Math.round((thumbW * 9) / 16) : row.h;
  const shown = full ? tx('settings.general.fullWidth') : `${h}px`;
  const btns = <>
    <Pressable disabled style={[styles.btn, { backgroundColor: accent.primary }]}><T mono size={13} w={800} color="#fff">❙❙</T></Pressable>
    <Pressable disabled style={[styles.btn, { borderWidth: 1, borderColor: theme.line }]}><T mono size={13} w={800}>✕</T></Pressable>
  </>;
  return (
    <View style={[styles.wrap, { borderBottomColor: theme.line }]}>
      <View style={styles.head}>
        <Label c={c} label={tx('settings.miniHeightRow.miniPlayerHeight')} en="mini_player_height (px)" hint={tx('settings.miniHeightRow.barShownBottomWhen')} />
        <View style={styles.grow}>
          <View style={styles.sliderRow}>
            <Slider value={full ? FULL_STOP : h} min={40} max={FULL_STOP} step={4} label={tx('settings.miniHeightRow.miniPlayerHeight')}
              onChange={(v) => c.set(K, v > MINI_MAX ? MINI_FULL : v)} />
            <T mono size={11} w={700} style={styles.num} color={K in c.dirty ? accent.primary : theme.ink}>{shown}</T>
          </View>
          <View style={styles.sliderRow}>
            <T size={9} dim style={styles.grow}>{blank ? tx('settings.miniHeightRow.notSetDefault64px') : tx('settings.miniHeightRow.defaultPx', { v0: DEFAULT })}{tx('settings.miniHeightRow.farRightFullWidth')}</T>
            {!blank && <SmallBtn onPress={() => c.set(K, '')}>{tx('settings.miniHeightRow.resetDefault')}</SmallBtn>}
          </View>
        </View>
      </View>
      <T size={9} dim style={styles.caption}>{tx('settings.miniHeightRow.previewBarTall')}</T>
      <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
        style={[full ? styles.barFull : [styles.bar, { height: row.h + 14 }], { borderColor: theme.line, backgroundColor: theme.isDark ? 'rgba(14,11,20,0.94)' : 'rgba(255,255,255,0.94)' }]}>
        {thumbW > 0 && <View style={[styles.thumb, { width: thumbW, height: thumbH, borderColor: theme.frame, backgroundColor: theme.surface2 }]} />}
        {/* 本物と同じく、帯が高い時は題名（上）とボタン（下）を縦に積み、もっと高い時は題名を縦書き・ボタンを縦1列にする */}
        {row.mode === 'tall' && !full ? (
          <View style={[styles.tall, { height: thumbH }]}>
            <VerticalTitle text={SAMPLE} height={thumbH} color={theme.ink} />
            <View style={styles.btnCol}>{btns}</View>
          </View>
        ) : (
          <View style={row.mode === 'stack' && !full ? [styles.side, { height: thumbH }] : [styles.under, !full && styles.grow]}>
            <View style={row.mode === 'stack' && !full ? undefined : styles.grow}>
              <T size={11} w={700} numberOfLines={1}>{SAMPLE}</T>
              <T mono size={8} dim numberOfLines={1}>{tx('settings.miniHeightRow.playing123424')}</T>
            </View>
            <View style={styles.btns}>{btns}</View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8, paddingHorizontal: 13, borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  side: { flex: 1, minWidth: 0, justifyContent: 'space-between' },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  tall: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  btnCol: { justifyContent: 'space-between', gap: 4 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: { minWidth: 48, textAlign: 'right' },
  barFull: { gap: 7, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8 },
  under: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  caption: { marginTop: 8, marginBottom: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10, borderWidth: 1, borderRadius: 8 },
  thumb: { borderRadius: 7, borderWidth: 1.5, flexShrink: 0 },
  btn: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
