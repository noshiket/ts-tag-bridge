import { fmtDur, fmtMs } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { pendingRange } from '../common/segmentEditing';
import { Btn, Tag } from '../common/splitButtons';
import { KeepRangeItem } from './KeepRangeItem';
import type { SplitScreenState } from './useSplitScreen';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * この話の採用区間（トリム）: 再生位置に TRIM IN / OUT を置いて足す、再生位置で2つに割る、足した区間の一覧と編集。
 * 採用区間が無い話は全体を出す
 */
export function SegmentTrimEditor({ s, i }: { s: SplitScreenState; i: number }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { ed, playhead, frameStatus, editing } = s;
  const mp = ed.pendingKeep?.segIdx === i ? ed.pendingKeep : null;
  const trims = ed.keepList[i] ?? [];
  const add = pendingRange(mp);
  const sideBtn = (side: 'in' | 'out') => {
    const v = mp?.[side];
    return (
      <Btn onPress={() => editing.markKeep(i, side, playhead)} bg={v != null ? accent.primary : theme.surface2} fg={v != null ? '#fff' : theme.ink}
        border={v != null ? theme.ink : theme.line} style={[styles.flex, styles.tall]}>
        {`TRIM ${side.toUpperCase()}${v != null ? `\n${fmtMs(v)}` : ''}`}
      </Btn>
    );
  };
  return (
    <View style={[styles.box, { borderTopColor: theme.line }]}>
      <View style={styles.row}>
        <T mono size={9} dim style={styles.ls}>{tx('split.segmentTrimEditor.keptRanges')}</T>
        {trims.length > 0 && frameStatus && (
          <Tag bg="transparent" fg={frameStatus === 'ready' ? accent.primary : theme.mute} border={theme.line}>{frameStatus === 'ready' ? tx('split.segmentTrimEditor.exact') : frameStatus === 'building' ? tx('split.segmentTrimEditor.generating') : tx('split.segmentTrimEditor.approx')}</Tag>
        )}
        <View style={styles.flex} />
        {mp && <Btn onPress={() => ed.setPendingKeep(null)} bg="transparent" fg={theme.mute}>{tx('split.segmentTrimEditor.cancel')}</Btn>}
      </View>
      <View style={styles.row}>{sideBtn('in')}{sideBtn('out')}</View>
      {add && (
        <Btn onPress={() => editing.addKeep(i, add.from, add.to)} bg={accent.primary} fg="#fff" border={theme.ink} style={styles.tall}>
          {tx('split.segmentTrimEditor.add', { v0: fmtMs(add.from), v1: fmtMs(add.to), v2: fmtDur(add.to - add.from) })}
        </Btn>
      )}
      {trims.some((tr) => tr.from < playhead && playhead < tr.to) && (
        <Btn onPress={() => ed.splitKeepAt(i, playhead)} border={theme.ink} style={styles.tall}>{tx('split.segmentTrimEditor.trimSplit', { v0: fmtMs(playhead) })}</Btn>
      )}
      {trims.map((tr, ti) => <KeepRangeItem key={ti} s={s} i={i} ti={ti} tr={tr} trims={trims} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingTop: 8, borderTopWidth: 1, borderStyle: 'dashed', gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1, minWidth: 0 },
  ls: { letterSpacing: 0.6 },
  tall: { paddingVertical: 8 },
});
