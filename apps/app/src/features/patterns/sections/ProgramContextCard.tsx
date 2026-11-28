import { analyzeContext, type PatternCtx } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { ProgramContextRow } from './ProgramContextRow';
import { EditorCard, editorStyles as es } from '../common/editorUi';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** パターン登録の上の「CONTEXT」: 番組情報と text_parser の文脈。番組が無ければ案内 */
export function ProgramContextCard({ ctx, tpContext, screen }: { ctx: PatternCtx | null; tpContext: Record<string, unknown>; screen?: boolean }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  if (!ctx) {
    return (
      <T size={11} dim style={[styles.none, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {screen ? '予約詳細から「パターン登録 →」で開くと番組情報が表示されます' : tx('common.noProgramInfo')}
      </T>
    );
  }
  return (
    <EditorCard color={accent.primary} w={2}>
      <View style={[es.rowC, es.mb8]}>
        <T mono size={9} w={800} color="#fff" style={[styles.badge, { backgroundColor: accent.primary }]}>CONTEXT</T>
        <T mono size={9} dim>{ctx.id}</T>
      </View>
      <ProgramContextRow label="TITLE" value={ctx.title} />
      <ProgramContextRow label="SERVICE" value={ctx.service_name} />
      <ProgramContextRow label="SID" value={String(ctx.sid || '')} />
      <ProgramContextRow label="ONID" value={ctx.onid != null ? String(ctx.onid) : ''} />
      <ProgramContextRow label="TSID" value={ctx.tsid != null ? String(ctx.tsid) : ''} />
      <ProgramContextRow label="START_TIME" value={String(analyzeContext(ctx, {}).start_time)} />
      <ProgramContextRow label="DESCRIPTION" value={ctx.description} />
      <ProgramContextRow label="EXTENDED_INFO" value={ctx.extended_info} pre />
      {Object.entries(tpContext).map(([kk, v]) => <ProgramContextRow key={kk} label={kk.toUpperCase()} value={String(v)} />)}
    </EditorCard>
  );
}

const styles = StyleSheet.create({
  badge: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, overflow: 'hidden' },
  none: { padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', textAlign: 'center' },
});
