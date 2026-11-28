import { Pressable, StyleSheet, View } from 'react-native';

import { ConfirmedFields } from './ConfirmedFields';
import { CONFIRMED_GREEN, CONFIRMED_RED, confirmedStyles as cs } from './confirmedParts';
import { ParseResultBlock } from './ParseResultBlock';
import { useConfirmedValues } from './useConfirmedValues';
import { useLibraryLink } from './useLibraryLink';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 何の確定値を直すか（保存先が変わる） */
export type ConfirmedTarget =
  | { kind: 'rule'; ruleId: number }
  | { kind: 'recording'; dbRecId: number }
  | { kind: 'video'; videoId: number };

/**
 * 解析確定値の編集（元の detail.jsx の ConfirmedFieldEditor）。上に解析の結果（読むだけ・項目ごとに反映）、
 * 下に確定値（直せる）。並びの列（複数話）は1話ずつの欄。
 * compact: 狭い所（再生画面の右パネル）では見出しを上・入力を下に積み、ライブラリへ飛ぶ ↗ は出さない（再生が止まるので）
 */
export function ConfirmedEditor({ target, confirmed, tp, parserError, node, compact, onSaved }: {
  target: ConfirmedTarget;
  confirmed: Record<string, unknown> | null;
  /** 解析の結果。null = まだ届いていない / {} = 解析したが結果なし */
  tp: Record<string, unknown> | null;
  parserError: string[] | string | null | undefined;
  node: string | null;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const tpData = tp ?? {};
  const s = useConfirmedValues(target, confirmed, tpData, node, onSaved);
  const libLink = useLibraryLink(node, !!compact, s.vals.title);
  const errText = Array.isArray(parserError) ? parserError.join(' / ') : parserError || '';

  return (
    <>
      <ParseResultBlock s={s} tp={tp} tpData={tpData} errText={errText} compact={compact} />
      <ConfirmedFields s={s} errText={errText} node={node} compact={compact} libLink={libLink} />
      <View style={[styles.foot, { borderTopColor: theme.line }]}>
        <Pressable onPress={() => void s.doSave(s.vals, s.manual)} disabled={s.saving}
          style={[styles.save, { backgroundColor: s.saving ? theme.surface2 : theme.ink, borderColor: theme.frame }]}>
          <T mono size={11} w={800} color={s.saving ? theme.mute : theme.onInk}>{s.saving ? tx('common.saving') : tx('common.save')}</T>
        </Pressable>
        <T mono size={9} dim>{`is_tp:${s.manual ? 0 : 1}`}</T>
        {!!s.msg && <T mono size={11} color={s.msg === '保存完了' ? CONFIRMED_GREEN : CONFIRMED_RED} style={cs.grow}>{s.msg}</T>}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1 },
  save: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5 },
});
