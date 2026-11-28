import { chapterName, cmAddonItems, cmPointAt, cmRanges, inputChapterAt, isCmLabel, type CmMarkDecl, type CmResult, type SegChapter } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { CM_ORANGE, markColor } from './cmColors';
import { stripStyles as ss } from './stripTouch';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/** 録画全体のタイムラインの下端の帯（CM候補・無音シーンチェンジ・アドオンの印）と、チャプター名の段 */
export function TimelineCmBand({ cm, total, inputChapters, decls }: { cm: CmResult; total: number; inputChapters: SegChapter[]; decls: CmMarkDecl[] }) {
  const { theme } = useTheme();
  const pct = (t: number) => `${(t / total) * 100}%` as const;
  const chapters = cm.jls_segments ?? [];
  return (
    <>
      <View pointerEvents="none" style={styles.band}>
        {cmRanges(cm, total).map(([cs, ce], i) => <View key={`c${i}`} style={[ss.abs, { left: pct(cs), width: `${Math.max(0.1, ((ce - cs) / total) * 100)}%`, top: 0, bottom: 0, backgroundColor: CM_ORANGE }]} />)}
        {(cm.scenes ?? []).map((sc, i) => <View key={`s${i}`} style={[ss.abs, { left: pct(sc.sec), top: 0, bottom: 0, width: 1, backgroundColor: theme.ink, opacity: 0.55 }]} />)}
        {/* アドオンが名乗った印。区間は上端の細い帯、位置は縦の線 */}
        {decls.flatMap((d) => cmAddonItems(cm, d.key).map((x, i) => (d.kind === 'range'
          ? <View key={`${d.key}${i}`} style={[ss.abs, { left: pct(x.start ?? 0), width: `${Math.max(0.1, (((x.end ?? x.start ?? 0) - (x.start ?? 0)) / total) * 100)}%`, top: 0, height: 3, backgroundColor: markColor(d) }]} />
          : <View key={`${d.key}${i}`} style={[ss.abs, { left: pct(cmPointAt(x).sec), top: 0, bottom: 0, width: 2, backgroundColor: markColor(d) }]} />)))}
      </View>
      {chapters.length > 0 && (
        <View pointerEvents="none" style={styles.chapters}>
          {chapters.map((c, i) => {
            const w = ((c.end - c.start) / total) * 100;
            if (w < 3) return null;
            return (
              <View key={i} style={[ss.abs, ss.center, { left: pct(c.start), width: `${w}%`, top: 0, bottom: 0, overflow: 'hidden' }]}>
                <T mono size={8} w={800} numberOfLines={1} color={isCmLabel(c.label) ? oklch(0.45, 0.19, 60) : theme.mute}>{inputChapterAt(cm, inputChapters, c.start) || chapterName(c.label)}</T>
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 7, backgroundColor: 'rgba(160,170,190,0.5)', zIndex: 2 },
  chapters: { position: 'absolute', left: 0, right: 0, bottom: 7, height: 11, zIndex: 2 },
});
