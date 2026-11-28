import { missingGroupRefs } from '@tstag/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SC } from '../common/colors';
import { editorStyles as es } from '../common/editorUi';
import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

export type TestResult = { ctx: string; loading?: boolean; error?: string; result?: Record<string, unknown>; sent?: Record<string, unknown>;
  /** 送ったアクションとパターン（パターンに無いグループの参照を結果の上で知らせるため） */
  refs?: { analyze: unknown; pattern: string; pattern2?: string } };

/** パターンのテスト実行の結果（k の場所で走らせた結果だけ出す）。送った中身は開いて見られる */
export function TestResultPanel({ result, k }: { result: TestResult | null; k: string }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [reqOpen, setReqOpen] = useState(false);
  if (!result || result.ctx !== k) return null;
  if (result.loading) return <T mono size={10} dim style={[styles.testBox, { backgroundColor: theme.surface2, borderColor: theme.line }]}>{tx('common.running')}</T>;
  const sentReq = result.sent && (
    <View style={[styles.sent, { borderTopColor: theme.line }]}>
      <Pressable onPress={() => setReqOpen((o) => !o)} style={es.rowC}><T mono size={9} dim>{`SENT REQUEST ${reqOpen ? '▲' : '▼'}`}</T></Pressable>
      {reqOpen && <ScrollView automaticallyAdjustKeyboardInsets style={styles.pre} nestedScrollEnabled><T mono size={9}>{JSON.stringify(result.sent, null, 2)}</T></ScrollView>}
    </View>
  );
  if (result.error) return (
    <View style={es.mb8}>
      <T mono size={10} color={SC.nomatch} style={[styles.testBox, styles.errBox]}>{result.error}</T>
      {sentReq}
    </View>
  );
  const fields = Object.entries(result.result ?? {}).filter(([kk]) => !kk.startsWith('_'));
  const missing = result.refs ? missingGroupRefs(result.refs.analyze, result.refs.pattern, result.refs.pattern2) : [];
  return (
    <View style={[styles.testBox, es.mb8, { backgroundColor: theme.surface2, borderColor: accent.primary }]}>
      <T mono size={9} w={800} color={accent.primary} style={es.mb4}>TEST RESULT</T>
      {/* 値が取れない原因で一番多いのが「パターンに無いグループの参照」なので先に出す（元と同じ） */}
      {missing.length > 0 && (
        <T mono size={10} color={errorBox.text} style={[es.warn, es.mb4, { backgroundColor: '#FFE3DE', borderColor: '#FF6853' }]}>
          {['パターンに無いグループを参照しています:',
            ...missing.map(([src, ns]) => `${ns.map((n) => `{$${n}}`).join(' ')} (pattern: ${JSON.stringify(src)})`),
            tx('patterns.testResultPanel.fixActionsReferenceNo')].join('\n')}
        </T>
      )}
      {fields.length === 0 && <T mono size={10} dim>{tx('patterns.testResultPanel.noFields')}</T>}
      {fields.map(([kk, v]) => (
        <View key={kk} style={styles.resRow}>
          <T mono size={9} dim style={styles.resKey}>{kk}</T>
          <View style={es.grow}>
            {Array.isArray(v) ? v.map((it, i) => <T range key={i} size={11} w={700} style={[styles.arrItem, { borderLeftColor: accent.primary }]}>{typeof it === 'object' ? JSON.stringify(it) : String(it)}</T>)
              : v !== null && typeof v === 'object' ? <T range mono size={9} color={SC.nomatch}>{JSON.stringify(v)}</T>
              : <T range size={11} w={700}>{String(v)}</T>}
          </View>
        </View>
      ))}
      {sentReq}
    </View>
  );
}

const styles = StyleSheet.create({
  resRow: { flexDirection: 'row', gap: 6, marginBottom: 4, alignItems: 'flex-start' },
  resKey: { width: 64, paddingTop: 2 },
  arrItem: { borderLeftWidth: 2, paddingLeft: 5, marginBottom: 1 },
  testBox: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  errBox: { backgroundColor: 'rgba(200,60,60,0.08)', borderColor: SC.nomatch },
  sent: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderStyle: 'dashed' },
  pre: { marginTop: 6, maxHeight: 240, padding: 6, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.15)' },
});
