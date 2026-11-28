import { fmtDur, fmtMs, trimFramePreview, type SplitSegment } from '@tstag/core';
import { useApi, type SplitEditor } from '@tstag/core/react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { pendingRange, type segmentEditing } from '../common/segmentEditing';
import { Btn, TimeRow } from '../common/splitButtons';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const GREEN_OK = '#0F7A2E';

/**
 * 分割タブの出力の1話: 押して開くと IN / OUT、SKIP、編集点で置くトリム（足す・割る・消す）。
 * 位置はすべて本体のプレイヤーの編集点（focusT）を使う
 */
export function TabSegmentCard({ dbRecId, node, editor, editing, seg, i, open, onToggle, focusT, efn, jumpTo }: {
  dbRecId: number; node: string | null; editor: SplitEditor; editing: ReturnType<typeof segmentEditing>; seg: SplitSegment; i: number;
  open: boolean; onToggle: () => void; focusT: number; efn: (t: number) => number; jumpTo: (t: number) => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const { FRAME } = editor;
  const none = editing.isNone(i);
  const last = i === editor.segments.length - 1;
  const skip = !none && (editor.skipList[i] || seg.start === seg.end);
  const mp = editor.pendingKeep?.segIdx === i ? editor.pendingKeep : null;
  const trims = editor.keepList[i] ?? [];
  const add = pendingRange(mp);
  const sideBtn = (side: 'in' | 'out') => {
    const v = mp?.[side];
    return (
      <Btn onPress={() => editing.markKeep(i, side, focusT)} bg={v != null ? accent.primary : theme.surface2} fg={v != null ? '#fff' : theme.ink}
        border={v != null ? theme.ink : theme.line} style={[styles.big, styles.flex]}>
        {`TRIM ${side.toUpperCase()}${v != null ? ` ${fmtMs(v)}` : ''}`}
      </Btn>
    );
  };
  return (
    <View style={[styles.card, { backgroundColor: none ? theme.surface2 : theme.surface, borderColor: open ? accent.primary : none ? theme.line : theme.frame, borderStyle: none ? 'dashed' : 'solid', opacity: none ? 0.7 : skip ? 0.5 : 1 }]}>
      <Pressable disabled={none} onPress={onToggle} style={styles.row}>
        {!none && <Image source={{ uri: api.recordings.frameUrl(dbRecId, Math.round(seg.start), node), headers: api.client.authHeaders() }} contentFit="cover" style={[styles.thumb, { borderColor: theme.frame }]} />}
        <View style={styles.flex}>
          <T mono size={10} w={800} dim={none} style={skip ? styles.strike : undefined}>{`${none ? 'None · 出力しない' : `#${String(seg.idx).padStart(2, '0')}`}${skip ? ' · SKIP' : ''}`}</T>
          <T mono size={9} dim>{`${fmtMs(seg.start)} → ${fmtMs(seg.end)} · ${fmtDur(seg.end - seg.start)}`}</T>
        </View>
        {!none && <Btn onPress={() => jumpTo(seg.start)}>jump</Btn>}
      </Pressable>
      {open && !none && (
        <View style={[styles.detail, { borderTopColor: theme.line }]}>
          <TimeRow label="IN" t={seg.start} efn={efn} frame={FRAME} onNudge={(d) => editing.nudgeIn(i, d)} onJump={() => jumpTo(seg.start)} onSet={() => editor.setInAt(i, focusT)} />
          <TimeRow label="OUT" t={seg.end} efn={efn} frame={FRAME} onNudge={(d) => editing.nudgeOut(i, d)} onJump={() => jumpTo(seg.end)} onSet={last ? () => editor.setLastOut(focusT) : () => editor.setOutAt(i, focusT)} />
          <Btn onPress={() => editing.toggleSkip(i)} bg={skip ? '#D9F2DF' : '#FBE3E1'} fg={skip ? GREEN_OK : '#8A1C1C'} border={skip ? '#2E9E4F' : '#C94A44'} style={styles.big}>
            {skip ? 'SKIP 解除' : tx('split.tabSegmentCard.notOutput')}
          </Btn>
          <View style={styles.row}>{sideBtn('in')}{sideBtn('out')}</View>
          {add && (
            <Btn onPress={() => editing.addKeep(i, add.from, add.to)} bg={accent.primary} fg="#fff" border={accent.primary} style={styles.big}>
              {tx('split.tabSegmentCard.add', { v0: fmtMs(add.from), v1: fmtMs(add.to), v2: fmtDur(add.to - add.from) })}
            </Btn>
          )}
          {/* 編集点を含む採用区間を2つに割る（隣り合ったまま） */}
          {trims.some((tr) => tr.from < focusT && focusT < tr.to) && (
            <Btn onPress={() => editor.splitKeepAt(i, focusT)} border={theme.ink} style={styles.big}>{tx('split.tabSegmentCard.trimSplit', { v0: fmtMs(focusT) })}</Btn>
          )}
          {trims.map((tr, ti) => (
            <View key={ti} style={[styles.row, styles.trim, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <T w={800} color={accent.primary}>✓</T>
              <T mono size={9} style={styles.flex}>{`${fmtMs(tr.from)} → ${fmtMs(tr.to)} ${trimFramePreview(tr.from, tr.to, FRAME > 0 ? 1 / FRAME : undefined)}`}</T>
              <Btn onPress={() => editing.removeKeep(i, ti)}>×</Btn>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  strike: { textDecorationLine: 'line-through' },
  card: { borderWidth: 1.5, borderRadius: 10, padding: 8 },
  thumb: { width: 52, height: 30, borderRadius: 5, borderWidth: 1, backgroundColor: '#000' },
  detail: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderStyle: 'dashed', gap: 6 },
  big: { paddingVertical: 6 },
  trim: { paddingVertical: 4, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1 },
});
