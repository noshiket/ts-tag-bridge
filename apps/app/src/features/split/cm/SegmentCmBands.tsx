import { cmAddonItems, cmPointAt, cmRanges, muteJump, type CmMarkDecl, type CmResult, type SegChapter, type SplitSegment, type TimeRange } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CHAP_A, CHAP_B, CM_ORANGE, MARK, markColor } from './cmColors';
import { stripStyles as ss } from './stripTouch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 話のスクラブバーの下端に重ねる CM解析（下段=うちの CM 判定 / 上段=アドオンの区間）と手で足した無音 */
export function ScrubCmOverlay({ cm, seg, manual, decls }: { cm: CmResult; seg: SplitSegment; manual: TimeRange[]; decls: CmMarkDecl[] }) {
  const { theme } = useTheme();
  const dur = Math.max(1, seg.end - seg.start);
  const l = (t: number) => `${((t - seg.start) / dur) * 100}%` as const;
  const width = (a: number, b: number) => `${Math.max(0.3, ((Math.min(b, seg.end) - Math.max(a, seg.start)) / dur) * 100)}%` as const;
  const within = (a: number, b: number) => b > seg.start && a < seg.end;
  return (
    <View pointerEvents="none" style={styles.scrubCm}>
      {cmRanges(cm, cm.total_sec ?? seg.end).filter(([a, b]) => within(a, b)).map(([a, b], i) => (
        <View key={`c${i}`} style={[ss.abs, { left: l(Math.max(a, seg.start)), width: width(a, b), top: 3, bottom: 0, backgroundColor: CM_ORANGE }]} />
      ))}
      {decls.filter((d) => d.kind === 'range').flatMap((d) => cmAddonItems(cm, d.key).map((b) => ({ d, a: b.start ?? 0, b: b.end ?? b.start ?? 0 })))
        .filter((x) => within(x.a, x.b)).map((x, i) => (
          <View key={`s${i}`} style={[ss.abs, { left: l(Math.max(x.a, seg.start)), width: width(x.a, x.b), top: 0, height: 3, backgroundColor: markColor(x.d) }]} />
        ))}
      {(cm.mutes ?? []).filter((m) => muteJump(m) >= seg.start && muteJump(m) < seg.end).map((m, i) => (
        <View key={`m${i}`} style={[ss.abs, { left: l(muteJump(m)), top: 3, bottom: 0, width: 1, backgroundColor: theme.ink, opacity: 0.5 }]} />
      ))}
      {decls.filter((d) => d.kind !== 'range').flatMap((d) => cmAddonItems(cm, d.key).map((x) => ({ d, t: cmPointAt(x).sec })))
        .filter((x) => x.t > seg.start && x.t < seg.end).map((x, i) => (
          <View key={`k${i}`} style={[ss.abs, { left: l(x.t), top: 3, bottom: 0, width: 2, backgroundColor: markColor(x.d) }]} />
        ))}
      {manual.filter((m) => m.from > seg.start && m.from < seg.end).map((m, i) => (
        <View key={`u${i}`} style={[ss.abs, { left: l(m.from), top: 3, bottom: 0, width: 2, backgroundColor: MARK.manual }]} />
      ))}
    </View>
  );
}

/** この話のチャプター帯（元の時間で並べるので、上のシークバーと位置が揃う。採用されない所は空き）。押すとその位置へ */
export function ChapterBand({ chapters, seg, onSeek }: { chapters: SegChapter[]; seg: SplitSegment; onSeek: (t: number) => void }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [w, setW] = useState(1);
  if (!chapters.length) return null;
  const dur = Math.max(1, seg.end - seg.start);
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width || 1)} style={[styles.chapBand, { backgroundColor: theme.surface2 }]}>
        {chapters.map((c, i) => {
          const l = ((c.src - seg.start) / dur) * 100;
          const wd = Math.max(0.3, ((c.src_end - c.src) / dur) * 100);
          if (l > 100 || l + wd < 0) return null;
          return (
            <Pressable key={i} onPress={() => onSeek(c.src)} style={[ss.abs, ss.center, { left: `${l}%`, width: `${wd}%`, top: 0, bottom: 0, backgroundColor: i % 2 ? CHAP_B : CHAP_A, borderRightWidth: 1, borderRightColor: theme.surface, overflow: 'hidden' }]}>
              <T mono size={7} w={800} color={theme.onInk} numberOfLines={1}>{(wd / 100) * w > 30 ? c.name : ''}</T>
            </Pressable>
          );
        })}
      </View>
      <T mono size={8} dim style={ss.mt2}>{tx('split.segmentCmBands.chaptersGapsDroppedEncoding', { v0: chapters.length })}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  scrubCm: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 8 },
  chapBand: { height: 13, marginTop: 4, borderRadius: 3, overflow: 'hidden' },
});
