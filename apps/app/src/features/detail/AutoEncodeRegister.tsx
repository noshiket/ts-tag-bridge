import { DEFAULT_AUTO_ENCODE_FLAGS, aeNorm, autoEncodeBody, ruleTargets, summarizeRule, type AutoEncodeFlags } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { Card } from './Card';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const RED = '#ef4444';

/**
 * 自動エンコードの設定（元の AutoEncodeRegister）: この確定値に当たるルールがあれば解除でき、
 * 無ければ一致の条件を選んで登録する。録画はサーバーが確定値を写し取り、予約は今の確定値を渡す
 */
export function AutoEncodeRegister({ dbRecId, confirmed, sid, node }: {
  dbRecId: number | null;
  confirmed: Record<string, unknown> | null;
  sid: number | null;
  node: string | null;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const rules = useQuery({ queryKey: ['autoEncode', node ?? ''], queryFn: () => api.autoEncode.list(node) });
  const [flags, setFlags] = useState<AutoEncodeFlags>(DEFAULT_AUTO_ENCODE_FLAGS);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const matched = (rules.data ?? []).filter((r) => ruleTargets(r, confirmed, sid));
  const c = confirmed || {};
  const rows: { key: keyof AutoEncodeFlags; ja: string; sub: string }[] = [
    { key: 'use_folder', ja: tx('detail.autoEncodeRegister.matchFolder'), sub: aeNorm(c.folder) },
    { key: 'use_title', ja: tx('detail.autoEncodeRegister.matchTitle'), sub: aeNorm(c.title) },
    { key: 'use_sid', ja: tx('detail.autoEncodeRegister.matchSid'), sub: sid != null ? `SID:${sid}` : '' },
    { key: 'require_episode_name', ja: tx('detail.autoEncodeRegister.runWhenEpisodeName'), sub: '' },
    { key: 'require_episode_number', ja: tx('detail.autoEncodeRegister.runWhenEpisodeNumber'), sub: '' },
    { key: 'allow_multi_episode', ja: tx('detail.autoEncodeRegister.runMultiEpisodeToo'), sub: '' },
  ];
  const hasCond = flags.use_folder || flags.use_title || flags.use_sid;
  const canSave = hasCond && !saving;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };
  const register = async () => {
    setSaving(true); setMsg('');
    try {
      await api.autoEncode.add(autoEncodeBody(dbRecId, confirmed, sid, flags), node);
      flash(tx('detail.autoEncodeRegister.registered'));
      void rules.refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: number) => {
    setBusyId(id); setMsg('');
    try {
      await api.autoEncode.remove(id, node);
      flash(tx('detail.autoEncodeRegister.removed'));
      void rules.refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <View style={styles.wrap}>
      <SectionTitle>{tx('detail.autoEncodeRegister.autoEncode')}</SectionTitle>
      {matched.length > 0 && (
        <View style={styles.mb}>
          <Card flat>
            {matched.map((rule, i) => (
              <View key={rule.id} style={[styles.ruleRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
                <View style={styles.grow}>
                  <T mono size={11} w={700} color={accent.primary}>{tx('detail.autoEncodeRegister.registered2', { v0: rule.id, v1: rule.enabled ? '' : tx('detail.autoEncodeRegister.disabled') })}</T>
                  <View style={styles.chips}>
                    {summarizeRule(rule).map((t) => <View key={t} style={[styles.chip, { backgroundColor: theme.surface2 }]}><T mono size={9}>{t}</T></View>)}
                  </View>
                </View>
                <Pressable onPress={() => void remove(rule.id)} disabled={busyId === rule.id}
                  style={[styles.btn, { backgroundColor: busyId === rule.id ? theme.line : RED, borderColor: theme.frame, boxShadow: busyId === rule.id ? 'none' : shadow(theme, 2) }]}>
                  <T mono size={11} w={700} color="#fff">{busyId === rule.id ? tx('detail.autoEncodeRegister.removing') : tx('common.remove')}</T>
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      )}
      <Card flat>
        {rows.map((row, i) => {
          const on = flags[row.key];
          return (
            <Pressable key={row.key} onPress={() => { setFlags((f) => ({ ...f, [row.key]: !f[row.key] })); setMsg(''); }}
              accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={[styles.flag, i > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
              <View style={[styles.box, { borderColor: theme.frame, backgroundColor: on ? accent.primary : theme.surface, boxShadow: `1.5px 1.5px 0px ${theme.ink}` }]}>
                {on && <T size={12} w={700} color="#fff">✓</T>}
              </View>
              <View style={styles.grow}>
                <T size={12} w={500}>{row.ja}</T>
                {!!row.sub && <T mono size={10} dim numberOfLines={1}>{row.sub}</T>}
              </View>
            </Pressable>
          );
        })}
      </Card>
      {!hasCond && <T size={10} color={RED} style={styles.warn}>{tx('detail.autoEncodeRegister.enableLeastOneFolder')}</T>}
      <View style={styles.foot}>
        <Pressable onPress={() => void register()} disabled={!canSave}
          style={[styles.reg, { backgroundColor: canSave ? accent.primary : theme.line, borderColor: theme.frame, boxShadow: canSave ? shadow(theme, 2) : 'none' }]}>
          <T mono size={12} w={700} color="#fff">{saving ? tx('common.registering') : tx('detail.autoEncodeRegister.registerAutoEncode')}</T>
        </Pressable>
        {!!msg && <T size={11} color={msg === tx('detail.autoEncodeRegister.registered') || msg === tx('detail.autoEncodeRegister.removed') ? accent.primary : RED} style={styles.grow}>{msg}</T>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  mb: { marginBottom: 10 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  chip: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6 },
  btn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1.5 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12 },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  warn: { marginTop: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  reg: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5 },
});
