import { Pressable, StyleSheet, View } from 'react-native';

import { SC, groupColor } from '../common/colors';
import { SmallBtn, editorStyles as es } from '../common/editorUi';
import { TestResultPanel } from './TestResultPanel';
import type { PatternEditorState } from '../state/usePatternEditor';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** この題名に当たるパターン: 完全マッチ（編集・登録・テスト）、追加候補（追加・削除）、どちらも無ければ NO MATCH */
export function MatchedPatterns({ ed }: { ed: PatternEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const { matched, candidates, sid } = ed.data;
  return (
    <>
      {matched.length > 0 && (
        <View style={es.section}>
          <SectionTitle>{tx('patterns.matchedPatterns.exactMatch')}</SectionTitle>
          {matched.map((r, i) => (
            <View key={i} style={[styles.mCard, { backgroundColor: theme.surface, borderColor: SC.matched, boxShadow: shadow(theme, 3, SC.matched) }]}>
              <View style={[styles.mHead, { backgroundColor: SC.matched }]}>
                <T mono size={9} w={800} color="#fff">{r.matchType === 'else' ? 'ELSE' : 'MATCHED'}</T>
                <View style={es.grow}>
                  <T mono size={9} color="rgba(255,255,255,0.8)" numberOfLines={1}>{r.analyzer.pattern}</T>
                  {!!r.analyzer.pattern2 && <T mono size={8} color="rgba(255,255,255,0.6)" numberOfLines={1}>{`AND: ${r.analyzer.pattern2}`}</T>}
                  {r.matchType === 'list' && <T mono size={8} color="rgba(255,255,255,0.6)">{`「${r.matchedStr}」`}</T>}
                  {r.matchType === 'else' && <T mono size={8} color="rgba(255,255,255,0.6)">{tx('patterns.matchedPatterns.unregisteredTitleElse')}</T>}
                </View>
                {r.adopted && <T mono size={8} w={800} color={SC.matched} style={styles.adopted}>{tx('common.use')}</T>}
                {r.matchType === 'else' ? (
                  <View style={es.rowC}>
                    <SmallBtn label={tx('patterns.matchedPatterns.editElse')} onPress={() => ed.openEditElse(r.analyzer)} />
                    <SmallBtn label={tx('patterns.matchedPatterns.register')} solid onPress={() => {
                      const v = String((r.analyzer.analyze ?? []).find((x) => 'switch' in x)?.switch ?? '').match(/\{\$(\d+)\}/)?.[1];
                      ed.openAddTitle(r.analyzer, (v ? r.groups[`g${v}`] : r.groups.g1) || '');
                    }} />
                  </View>
                ) : <SmallBtn label={tx('common.edit2')} onPress={() => ed.openEditList(r.analyzer, r.matchedStr ?? '')} />}
              </View>
              <View style={styles.mBody}>
                {Object.entries(r.parseResult).filter(([kk]) => !kk.startsWith('_')).map(([kk, v]) => (
                  <View key={kk} style={styles.resRow}><T mono size={9} dim style={styles.kv}>{kk}</T><T size={11} w={700} style={es.grow}>{String(v)}</T></View>
                ))}
                <Pressable style={[es.outline, { borderColor: SC.matched }]} onPress={() => {
                  if (!sid) return;
                  void ed.test(`matched_${i}`, { analyze: r.analyzer.analyze ?? [], pattern: r.analyzer.pattern, text: ed.normalizedTitle,
                    ...(r.analyzer.pattern2 ? { pattern2: r.analyzer.pattern2, text2: r.analyzer.text2 } : {}) });
                }}>
                  <T mono size={9} color={SC.matched}>{tx('common.testRun')}</T>
                </Pressable>
                <TestResultPanel result={ed.testResult} k={`matched_${i}`} />
              </View>
            </View>
          ))}
        </View>
      )}

      {candidates.length > 0 && (
        <View style={es.section}>
          <SectionTitle>{tx('patterns.matchedPatterns.candidates')}</SectionTitle>
          {candidates.map((r, i) => (
            <View key={i} style={[styles.mCard, { backgroundColor: theme.surface, borderColor: SC.unregistered, boxShadow: shadow(theme, 3, SC.unregistered) }]}>
              <View style={[styles.mHead, { backgroundColor: SC.unregistered }]}>
                <T mono size={9} w={800} color="#fff">UNREGISTERED</T>
                <T mono size={9} color="rgba(255,255,255,0.8)" numberOfLines={1} style={es.grow}>{r.analyzer.pattern}</T>
                <SmallBtn label={tx('common.add')} onPress={() => ed.openAddTitle(r.analyzer, r.newValue || '')} />
                {ed.screen && (
                  <Pressable style={[es.small, styles.delCand]} onPress={() => void ed.removeCandidate(r.analyzer)}>
                    <T mono size={9} w={800} color="rgba(255,180,180,1)">{tx('reservations.list.sheet.delete')}</T>
                  </Pressable>
                )}
              </View>
              <T size={11} style={styles.mBody}>
                「<T size={11} w={800}>{r.newValue}</T>」がswitch条件に未登録。グループ:
                {Object.entries(r.groups).map(([kk, v]) => (
                  <T key={kk} mono size={10}>{'  '}<T mono size={10} w={800} color={groupColor(+kk.replace('g', ''))}>{`{$${kk.replace('g', '')}}`}</T>{`=${v}`}</T>
                ))}
              </T>
            </View>
          ))}
        </View>
      )}

      {matched.length === 0 && candidates.length === 0 && !!ed.ctx?.title && (
        <View style={es.section}>
          <View style={[styles.nomatch, { backgroundColor: theme.surface2, borderColor: SC.nomatch }]}>
            <T mono size={10} w={800} color={SC.nomatch} style={es.mb4}>NO MATCH</T>
            <T size={11} dim>{tx('patterns.matchedPatterns.noPatternMatchesCreate')}</T>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  mCard: { borderWidth: 1.5, borderRadius: 14, overflow: 'hidden', marginBottom: 8 },
  mHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
  mBody: { paddingVertical: 8, paddingHorizontal: 12 },
  adopted: { backgroundColor: '#fff', borderRadius: 5, paddingVertical: 1, paddingHorizontal: 6, overflow: 'hidden' },
  delCand: { backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,100,100,0.6)' },
  resRow: { flexDirection: 'row', gap: 6, marginBottom: 4, alignItems: 'flex-start' },
  kv: { width: 80 },
  nomatch: { padding: 14, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
});
