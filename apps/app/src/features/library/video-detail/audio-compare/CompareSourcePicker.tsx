import { reusableRecord, syncMethodLabel, type SyncRecord } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { CMP_RED, CmpBtn, cmpStyles } from './compareParts';
import type { AudioCompare } from './useAudioCompare';
import { HistoryInput } from '../../../../ui/inputs/HistoryInput';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 1. 比べる相手を選ぶ（候補かパス）・取り込むもの（字幕/コメント）を選んで走らせる。
 * 同じ相手で前に解析していれば、その時間の対応ですぐ取り込める
 */
export function CompareSourcePicker({ a, records }: { a: AudioCompare; records: SyncRecord[] }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { sel, has, busy, canRun } = a;
  const list = [...(a.cands?.videos ?? []), ...(a.cands?.recordings ?? [])];
  const reusable = reusableRecord(records, sel);
  return (
    <>
      {a.cands === null && <T size={10} dim>{tx('library.compareSourcePicker.searchingCandidates')}</T>}
      {list.map((c) => {
        const on = sel?.kind === c.kind && sel.id === c.id;
        return (
          <Pressable key={`${c.kind}${c.id}`} onPress={() => { a.setSel(c); a.setPath(''); }}
            style={[styles.cand, { backgroundColor: on ? theme.surface2 : 'transparent', borderColor: on ? accent.primary : theme.line }]}>
            <T size={11} w={700} numberOfLines={1}>{`${c.kind === 'video' ? '📼' : '⏺'} ${c.title || c.path.split('/').pop()}`}</T>
            <T mono size={9} dim style={styles.mt1}>
              {`${c.station || '局不明'} · ${(c.recording_start_time || '').slice(0, 16).replace('T', ' ')}${c.has_caption ? ' · 字幕あり' : ''}${(c.comment_count ?? 0) > 0 ? ` · コメント${c.comment_count}件` : ''}`}
            </T>
            {/* 中身が足りない相手（入力が CM カット済みだったなど）。選ぶと一部しか合わずコメントが大きく落ちる */}
            {!!c.duration_gap && <T mono size={9} color={CMP_RED} style={styles.mt1}>{tx('library.compareSourcePicker.sContentMissingOnly', { v0: Math.round(c.duration_gap) })}</T>}
          </Pressable>
        );
      })}
      {a.cands !== null && list.length === 0 && <T size={10} dim>{tx('library.compareSourcePicker.noCandidateMatchingConfirmed')}</T>}
      <HistoryInput histKey="video_path" value={a.path} onChangeText={(v) => { a.setPath(v); a.setSel(null); }} placeholder={tx('library.compareSourcePicker.enterFilePathDirectly')}
        style={[styles.path, { borderColor: a.path ? accent.primary : theme.line, backgroundColor: theme.surface2 }]} />
      {/* 取り込むものを先に選ぶ。相手が持っていないものは選べない（走らせてから失敗するのを防ぐ） */}
      <View style={styles.kinds}>
        {([['字幕', has.caption, a.capOn, a.setCapOn], ['コメント', has.comment, a.cmtOn, a.setCmtOn]] as const).map(([label, avail, on, set]) => (
          <View key={label} style={cmpStyles.grow}>
            <CmpBtn disabled={!avail} onPress={() => set(!on)} bg={avail && on ? accent.primary : undefined} color={avail && on ? '#fff' : theme.mute}>
              {avail ? `${on ? '✓ ' : ''}${label}を取り込む` : `${label}なし`}
            </CmpBtn>
          </View>
        ))}
      </View>
      {!!sel?.duration_gap && <T mono size={9} color={CMP_RED} style={styles.lh}>{tx('library.compareSourcePicker.chosenSourceMissingS', { v0: Math.round(sel.duration_gap) })}</T>}
      <CmpBtn disabled={busy || !canRun} onPress={() => void a.runFull(false)} bg={accent.primary} color="#fff" big>
        {busy ? '実行中…' : canRun ? '▶ 無音区間・場面の切り替わりで合わせて取り込む（約3分）' : '取り込めるものがありません'}
      </CmpBtn>
      {/* 別の方式。ずれは 500ms 刻みのままなので字幕には向かないが、40秒で終わる */}
      <CmpBtn disabled={busy || !canRun} onPress={() => void a.runFull(true)} big>{tx('library.compareSourcePicker.importAudioCompareOnly')}</CmpBtn>
      <T mono size={9} color={has.caption && a.capOn ? CMP_RED : theme.mute}>
        {has.caption && a.capOn ? '音声比較だけの取り込みは最大 500ms ずれます。字幕には上を使ってください。' : 'コメントだけなら音声比較だけでも十分です（500ms のずれは分かりません）。'}
      </T>
      {reusable && (
        <CmpBtn disabled={busy || !canRun} onPress={() => void a.applyRecord(reusable)} color={accent.secondary} border={accent.secondary} big>
          {tx('library.compareSourcePicker.importPreviousResultInstant', { v0: (reusable.applied_at || '').slice(0, 10), v1: syncMethodLabel(reusable.method) })}
        </CmpBtn>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  mt1: { marginTop: 1 },
  cand: { paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1.5 },
  path: { fontSize: 10, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1 },
  kinds: { flexDirection: 'row', gap: 6 },
  lh: { lineHeight: 15 },
});
