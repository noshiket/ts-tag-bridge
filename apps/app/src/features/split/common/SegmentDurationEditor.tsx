import type { SegState, SplitEditor } from '@tstag/core/react';
import { StyleSheet, View } from 'react-native';

import { Btn, Tag } from './splitButtons';
import { minSec } from './segmentEditing';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 話の長さのチップを押した時の編集: 固定・調整・自動の切り替え、±分、1話の長さに戻す。
 * compact は再生画面のタブ向け（番号だけ・長さの表示なし）
 */
export function SegmentDurationEditor({ ed, idx, onClose, compact }: { ed: SplitEditor; idx: number; onClose: () => void; compact?: boolean }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const dur = ed.segments[idx] ? ed.segments[idx]!.end - ed.segments[idx]!.start : 0;
  const isDefault = Math.abs(dur - ed.intervalMin * 60) <= 1;
  const st: SegState = ed.pinnedSegs.has(idx) ? 'fixed' : ed.isAdjusted && !isDefault ? 'adjusted' : 'auto';
  const no = String(idx + 1).padStart(2, '0');
  return (
    <View style={[styles.box, { backgroundColor: theme.surface, borderColor: accent.primary }]}>
      <Tag bg={accent.primary} fg="#fff">{compact ? `#${no}` : `SEG #${no}`}</Tag>
      <Btn onPress={() => ed.toggleSegmentPin(idx, st)} bg={st === 'fixed' ? oklch(0.35, 0.18, 280) : st === 'adjusted' ? oklch(0.45, 0.15, 280) : theme.surface2} fg={st === 'auto' ? theme.mute : '#fff'}>
        {st === 'fixed' ? '固定' : st === 'adjusted' ? '調整' : tx('common.auto')}
      </Btn>
      {!compact && <T mono size={13} w={800} style={styles.dur}>{minSec(dur)}</T>}
      {([[-5, '−5m'], [-1, '−1m'], [1, tx('split.segmentDurationEditor.1m')], [5, tx('split.segmentDurationEditor.5m')]] as const).map(([d, l]) => <Btn key={d} onPress={() => ed.nudgeSegmentDuration(idx, d * 60)}>{l}</Btn>)}
      {!isDefault && <Btn onPress={() => ed.resetSegmentToDefault(idx)} bg="transparent" fg={theme.mute}>{`↻ ${ed.intervalMin}m`}</Btn>}
      <Btn onPress={onClose} bg={theme.ink} fg={theme.onInk}>×</Btn>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5 },
  dur: { minWidth: 54, textAlign: 'center' },
});
