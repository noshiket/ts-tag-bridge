import { chapterName, fmtDur, fmtMs, keepChapters, type KeepRange } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { Btn, Tag } from '../common/splitButtons';
import type { SplitScreenState } from './useSplitScreen';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 採用区間（トリム）の1つ: 時刻・章名・長さ・採用するコマの番号。編集を開くと IN / OUT の微調整と、
 * 区間にかかる章の名前（エンコード後のチャプター名。空なら自動）を変えられる
 */
export function KeepRangeItem({ s, i, ti, tr, trims }: { s: SplitScreenState; i: number; ti: number; tr: KeepRange; trims: KeepRange[] }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { ed, seek, efn } = s;
  const editing = (ed.editingKeep as { segIdx: number; trimIdx: number } | null)?.segIdx === i && (ed.editingKeep as { trimIdx: number }).trimIdx === ti;
  const chapters = keepChapters(s.cmq.segChapters[i] ?? [], trims, tr.from);
  const nameInput = [styles.nameInput, { backgroundColor: theme.surface, color: theme.ink, borderColor: theme.line }];
  const edRow = (label: string, field: 'from' | 'to', val: number) => (
    <View style={styles.row}>
      <Tag bg={accent.primary} fg="#fff" border={theme.ink}>{label}</Tag>
      {([[-1, '−1s'], [-0.1, '−100ms']] as const).map(([d, l]) => <Btn key={l} onPress={() => { ed.updateKeep(i, ti, field, val + d); seek(val + d); }}>{l}</Btn>)}
      <View style={[styles.timeBox, { backgroundColor: theme.ink }]}><T mono size={10} w={800} color={theme.onInk}>{`${fmtMs(val)} #${efn(val)}`}</T></View>
      {([[0.1, '+100ms'], [1, '+1s']] as const).map(([d, l]) => <Btn key={l} onPress={() => { ed.updateKeep(i, ti, field, val + d); seek(val + d); }}>{l}</Btn>)}
      <Btn onPress={() => seek(val)} bg={theme.surface}>↵</Btn>
      <Btn onPress={() => ed.updateKeep(i, ti, field, s.playhead)} bg={accent.primary} fg="#fff" border={theme.ink}>←PH</Btn>
    </View>
  );
  return (
    <View style={[styles.item, { backgroundColor: theme.surface2, borderColor: editing ? theme.ink : theme.line }]}>
      <View style={[styles.head]}>
        <T w={800} color={accent.primary}>✓</T>
        <View style={styles.flex}>
          <T mono size={9} w={800}>{`${fmtMs(tr.from)} → ${fmtMs(tr.to)}`}</T>
          <T mono size={9} dim>
            {chapters.length ? chapters.map((m, mi) => (
              <T key={mi} mono size={9} w={mi === 0 && tr.name ? 800 : 400} color={mi === 0 && tr.name ? accent.primary : theme.mute}>{`${mi ? ' + ' : ''}${m.name}(${fmtMs(m.start)}〜${fmtMs(m.end)})`}</T>
            )) : tx('split.keepRangeItem.noChapterName')}
            {tx('split.keepRangeItem.keep', { v0: fmtDur(tr.to - tr.from), v1: s.efPreview(tr.from, tr.to) })}
          </T>
        </View>
        <Btn onPress={() => ed.setEditingKeep(editing ? null : { segIdx: i, trimIdx: ti })} bg={editing ? theme.ink : 'transparent'} fg={editing ? theme.onInk : theme.mute}>{editing ? tx('common.close') : tx('common.edit')}</Btn>
        <Btn onPress={() => { s.editing.removeKeep(i, ti); if (editing) ed.setEditingKeep(null); }} bg="transparent" fg={theme.mute}>×</Btn>
      </View>
      {editing && (
        <View style={[styles.edit, { borderTopColor: theme.line }]}>
          {edRow('IN', 'from', tr.from)}
          {edRow('OUT', 'to', tr.to)}
          {chapters.map((m, mi) => {
            const cur = ed.chapNames[i]?.[Number(m.src).toFixed(3)] ?? '';
            return (
              <View key={`c${mi}`} style={styles.row}>
                <Btn onPress={() => seek(m.src)} bg={theme.ink} fg={theme.onInk}>{fmtMs(m.src)}</Btn>
                <TextInput value={cur} placeholder={m.name} placeholderTextColor={theme.mute} onChangeText={(v) => ed.setChapName(i, m.src, v)} style={nameInput} />
                <T mono size={8} dim>{tx('split.keepRangeItem.output', { v0: chapterName(m.label), v1: fmtMs(m.start), v2: fmtMs(m.end) })}</T>
                {!!cur && <Btn onPress={() => ed.setChapName(i, m.src, '')} bg="transparent" fg={theme.mute}>{tx('common.auto')}</Btn>}
              </View>
            );
          })}
          {/* エンコード後のチャプター名。空なら Amatsukaze の名前のまま */}
          <View style={styles.row}>
            <Tag bg={accent.primary} fg="#fff" border={theme.ink}>{tx('split.keepRangeItem.chapterName')}</Tag>
            <TextInput value={tr.name ?? ''} onChangeText={(v) => ed.renameKeep(i, ti, v)} placeholderTextColor={theme.mute} style={nameInput}
              placeholder={chapters.length ? tx('split.keepRangeItem.blankUses', { v0: chapters[0]!.name }) : tx('split.keepRangeItem.blankKeepsAmatsukazesName')} />
            {['OP', 'ED', tx('split.keepRangeItem.main'), tx('split.keepRangeItem.preview')].map((nm) => (
              <Btn key={nm} onPress={() => ed.renameKeep(i, ti, nm)} bg={tr.name === nm ? theme.ink : theme.surface2} fg={tr.name === nm ? theme.onInk : theme.ink}>{nm}</Btn>
            ))}
            {!!tr.name && <Btn onPress={() => ed.renameKeep(i, ti, '')} bg="transparent" fg={theme.mute}>{tx('common.auto')}</Btn>}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  item: { borderRadius: 8, borderWidth: 1.5, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 8 },
  edit: { padding: 8, borderTopWidth: 1, borderStyle: 'dashed', gap: 5 },
  timeBox: { flex: 1, minWidth: 96, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center' },
  nameInput: { flex: 1, minWidth: 96, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, fontSize: 10, fontFamily: monoFamily[800] },
});
