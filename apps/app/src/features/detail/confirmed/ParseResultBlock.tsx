import { TP_TO_DB, applyAllTp, applyTpKey } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { CONFIRMED_RED, confirmedStyles as cs } from './confirmedParts';
import type { ConfirmedState } from './useConfirmedValues';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 解析の結果（読むだけ）。項目ごと・全項目を確定値の欄へ反映、反映して保存 */
export function ParseResultBlock({ s, tp, tpData, errText, compact }: {
  s: ConfirmedState; tp: Record<string, unknown> | null; tpData: Record<string, unknown>; errText: string; compact?: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const tpEntries = Object.entries(tpData).filter(([k]) => !k.startsWith('_'));
  return (
    <View style={[cs.block, styles.blockTop, { borderBottomColor: theme.line }]}>
      <View style={styles.head}>
        <T mono size={9} w={700} dim style={cs.ls}>TEXT_PARSER RESULT</T>
        {tpEntries.length > 0 && (
          <Pressable onPress={() => { s.setVals((v) => applyAllTp(v, tpData, s.kind)); s.setManual(false); }}
            accessibilityLabel={tx('detail.parseResultBlock.applyParseResultAll')} style={[cs.pill, { backgroundColor: accent.primary }]}>
            <T mono size={8} w={800} color="#fff">{tx('detail.parseResultBlock.applyAll')}</T>
          </Pressable>
        )}
      </View>
      {tpEntries.length > 0 ? (
        <>
          <View style={styles.list}>
            {tpEntries.map(([k, v]) => {
              const isErr = k === 'parser_error';
              return (
                <View key={k} style={compact ? styles.rowCompact : styles.row}>
                  <T mono size={9} w={700} color={isErr ? CONFIRMED_RED : theme.mute} style={compact ? undefined : styles.key}>{k}</T>
                  <T size={11} w={500} color={isErr ? CONFIRMED_RED : theme.ink} style={cs.grow}>{Array.isArray(v) ? v.join(', ') : String(v)}</T>
                  {k in TP_TO_DB && (
                    <Pressable onPress={() => s.setVals((x) => applyTpKey(x, tpData, k, s.kind))} style={[cs.pill, { backgroundColor: accent.primary }]}>
                      <T mono size={8} w={800} color="#fff">{tx('common.apply')}</T>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
          <Pressable onPress={s.applyAndSave} disabled={s.saving} style={[styles.applySave, { backgroundColor: s.saving ? theme.surface2 : accent.primary }]}>
            <T mono size={10} w={800} color={s.saving ? theme.mute : '#fff'}>{s.saving ? tx('common.saving') : tx('detail.parseResultBlock.applySave')}</T>
          </Pressable>
        </>
      ) : (
        // 解析結果が空でも「パターン未マッチ」とは限らない（一覧では解析結果を落としている）。未マッチかは parser_error で見る
        <T mono size={11} color={errText ? CONFIRMED_RED : theme.mute}>
          {errText ? `パターン未マッチ — ${errText}` : tp == null ? '解析結果を読み込み中…' : '解析結果なし（パターンに当たっていません）'}
        </T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blockTop: { borderBottomWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  list: { gap: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowCompact: { gap: 2 },
  key: { width: 110 },
  applySave: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 7 },
});
