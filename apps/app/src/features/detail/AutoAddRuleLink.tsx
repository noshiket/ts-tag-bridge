import { useApi, useAutoAdd } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chev } from '../../ui/parts/Icons';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * 予約の元になった自動予約ルールへの案内（元の detail_res.jsx の「自動予約ルール / AUTO-ADD RULE」）。
 * 予約が覚えているルール（auto_add_id。0 は自動予約ではない）を出し、まだ分からなければ候補を問い合わせる。
 * 候補が1つならサーバーが覚えるので、予約の一覧を取り直す（元と同じ）
 */
export function AutoAddRuleLink({ ruleId, autoAddId, node }: { ruleId: number | null; autoAddId: number | null; node: string | null }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const all = useAutoAdd(node);
  const cands = useQuery({
    queryKey: ['autoAddCandidates', node ?? '', ruleId],
    queryFn: () => api.autoAdd.candidates(ruleId!, node),
    enabled: ruleId != null && autoAddId == null,
    staleTime: Infinity,
  });
  useEffect(() => { if (cands.data?.saved && cands.data.autoAddId != null) void qc.invalidateQueries({ queryKey: ['reserves', node ?? ''] }); }, [cands.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ruleId == null) return null;
  const list = autoAddId != null ? (autoAddId !== 0 ? (all.data ?? []).filter((a) => a.id === autoAddId) : []) : cands.data?.candidates ?? [];
  if (!list.length) return null;
  return (
    <View style={styles.wrap}>
      <SectionTitle>{tx('detail.autoAddRuleLink.autoReserveRule')}</SectionTitle>
      {list.map((a) => (
        <Pressable key={a.id} onPress={() => router.push({ pathname: '/autoadd/[id]', params: { id: String(a.id), ...(node ? { node } : {}) } })}
          style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
          <View style={[styles.id, { backgroundColor: theme.surface2 }]}><T mono size={8} dim>{`id:${a.id}`}</T></View>
          <T size={13} w={700} numberOfLines={1} style={styles.grow}>{a.andKey || tx('detail.autoAddRuleLink.noKeyword')}</T>
          {list.length > 1 && <T mono size={9} w={700} color={accent.tertiary}>{tx('detail.autoAddRuleLink.candidates')}</T>}
          <Chev s={10} c={theme.mute} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1.5 },
  id: { paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3 },
  grow: { flex: 1 },
});
