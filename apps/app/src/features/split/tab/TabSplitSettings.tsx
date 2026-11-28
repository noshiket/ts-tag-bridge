import type { SplitEditor } from '@tstag/core/react';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { minSec } from '../common/segmentEditing';
import { SegmentDurationEditor } from '../common/SegmentDurationEditor';
import { Btn, Tag } from '../common/splitButtons';
import { splitColors } from '../common/splitColors';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 分割タブの設定（分割画面の SplitControls を詰めたもの）: 状態・1話の長さ・余りの位置・ショートカット・つなげる / 離す・話の長さのチップ */
export function TabSplitSettings({ editor, isNone }: { editor: SplitEditor; isNone: (i: number) => boolean }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { episodeCount, isAdjusted, isModified, intervalMin, remainderAt, linked, segments } = editor;
  const [chipIdx, setChipIdx] = useState<number | null>(null);
  const parts = segments.map((s) => s.end - s.start);
  return (
    <>
      <View style={styles.row}>
        <Tag bg={isAdjusted ? accent.primary : theme.ink} fg="#fff">{isModified ? 'ADJUSTED' : 'AUTO'}</Tag>
        <Tag bg={theme.surface2} fg={accent.tertiary} border={theme.line}>{tx('common.eps', { v0: episodeCount })}</Tag>
        <View style={styles.flex} />
        {isModified && <Btn onPress={editor.resetAdjustments}>{tx('split.tabSplitSettings.auto')}</Btn>}
      </View>
      <View style={styles.row}>
        <T mono size={9} dim>{tx('split.tabSplitSettings.perEp')}</T>
        <Btn onPress={() => editor.pickInterval(Math.max(1, intervalMin - 1))} style={styles.pm}>−</Btn>
        <TextInput value={String(intervalMin)} keyboardType="numeric" onChangeText={(v) => { const n = parseInt(v, 10); if (!Number.isNaN(n) && n >= 1) editor.pickInterval(n); }}
          style={[styles.num, { borderColor: theme.frame, backgroundColor: theme.surface2, color: theme.ink }]} />
        <T mono size={9} dim>m</T>
        <Btn onPress={() => editor.pickInterval(intervalMin + 1)} style={styles.pm}>{tx('common.plus')}</Btn>
        <View style={styles.flex} />
        <View style={[styles.seg, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {([['start', tx('split.tabSplitSettings.remFirst')], ['end', tx('split.tabSplitSettings.remLast')]] as const).map(([k, l]) => (
            <Pressable key={k} onPress={() => editor.pickRemainderAt(k)} style={[styles.segBtn, remainderAt === k && { backgroundColor: theme.ink }]}>
              <T mono size={9} w={800} color={remainderAt === k ? theme.onInk : theme.mute}>{l}</T>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={[styles.row, styles.wrap]}>
        {[5, 15, 25, 30, 45, 60].map((m) => {
          const on = !isAdjusted && intervalMin === m;
          return <Btn key={m} onPress={() => editor.pickInterval(m)} bg={on ? accent.primary : 'transparent'} fg={on ? '#fff' : theme.mute} border={on ? accent.primary : theme.line} style={{ opacity: isAdjusted ? 0.55 : 1 }}>{`${m}m`}</Btn>;
        })}
        <View style={styles.flex} />
        <Btn onPress={() => editor.setLinked((v) => !v)} bg={linked ? accent.primary : 'transparent'} fg={linked ? '#fff' : splitColors.tabRed} border={linked ? accent.primary : splitColors.tabRed}>{linked ? 'LINKED' : 'UNLINK'}</Btn>
      </View>

      {/* BREAKDOWN */}
      <View style={[styles.chips, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {parts.map((p, i) => {
          const rem = isNone(i);
          const on = !rem && chipIdx === i;
          return (
            <Fragment key={i}>
              {i > 0 && <T mono size={11} dim style={styles.half}>+</T>}
              <Pressable disabled={rem} onPress={() => setChipIdx(on ? null : i)}
                style={[styles.chip, { backgroundColor: on ? accent.primary : rem ? theme.surface : theme.ink, borderColor: on ? accent.primary : rem ? theme.line : theme.frame, borderStyle: rem ? 'dashed' : 'solid', opacity: rem ? 0.7 : 1 }]}>
                <T mono size={10} w={800} color={on ? '#fff' : rem ? theme.mute : theme.onInk}>{rem ? 'None' : minSec(p)}</T>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
      {chipIdx != null && chipIdx < parts.length && <SegmentDurationEditor compact ed={editor} idx={chipIdx} onClose={() => setChipIdx(null)} />}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexWrap: 'wrap', gap: 4 },
  flex: { flex: 1 },
  half: { opacity: 0.5 },
  pm: { width: 24, paddingHorizontal: 0 },
  num: { width: 44, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 6, borderWidth: 1.5, textAlign: 'center', fontSize: 12, fontFamily: monoFamily[800] },
  seg: { flexDirection: 'row', padding: 2, borderRadius: 8, borderWidth: 1, gap: 1 },
  segBtn: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1 },
  chip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1.5 },
});
