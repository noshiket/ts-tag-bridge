import { canSaveManuAdd, initManuAddForm, initRecSetting, manuAddBody, type ManuAddForm, type ManuAddRaw } from '@tstag/core';
import { useApi, useServices } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ManuAddConditions } from './ManuAddConditions';
import { Trash } from '../../../ui/parts/Icons';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { NodeBadge } from '../../library/NodeSwitcher';
import { RecSettingFormView } from '../../recsetting/RecSettingForm';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);

/**
 * プログラム予約の編集の中身: 予約条件（ManuAddConditions）と録画設定の2つのタブ、保存・削除（終わったら一覧へ）。
 * 新規は EDCB の既定のプリセット（0）を録画設定の始めの値にする
 */
export function ManuAddEditor({ item, node, back }: { item: ManuAddRaw | null; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const [form, setForm] = useState<ManuAddForm>(() => initManuAddForm(item));
  const set = <K extends keyof ManuAddForm>(k: K, v: ManuAddForm[K]) => setForm((p) => ({ ...p, [k]: v }));
  const [tab, setTab] = useState<'cond' | 'rec'>('cond');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const services = useServices(node);
  const recOpts = useQuery({ queryKey: ['recSettingOptions', node ?? ''], queryFn: () => api.recSetting.options(node) });
  const tuners = useQuery({ queryKey: ['tuners', node ?? ''], queryFn: () => api.recSetting.tuners(node) });
  useEffect(() => {
    const presets = recOpts.data?.presets ?? [];
    if (item || !presets.length) return;
    const def = presets.find((p) => Number(p.value) === 0) ?? presets[0];
    if (def?.rec_setting) setForm((p) => ({ ...p, ...initRecSetting(def.rec_setting), presetID: String(def.value) }));
  }, [recOpts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = canSaveManuAdd(form);
  const done = async () => { await qc.invalidateQueries({ queryKey: ['autoAdd', node ?? ''] }); back(); };
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      if (item) await api.autoAdd.manu.update(item.id, manuAddBody(form), node);
      else await api.autoAdd.manu.add(manuAddBody(form), node);
      await done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx('common.couldntSave2'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!item) return;
    try { await api.autoAdd.manu.remove(item.id, node); await done(); } catch (e) { setErr(e instanceof Error ? e.message : tx('common.couldntDelete')); }
  };

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TopBar title={tx('common.programReserve')} onBack={back} afterTitle={<NodeBadge node={node} />} />
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={9} dim>{item ? `id:${item.id}` : tx('autoReserve.manuAddEditor.new')}</T></View>
          {!!item?.station_name && (
            <View style={[styles.tag, { backgroundColor: `${accent.tertiary}33` }]}><T mono size={9} w={700} color={accent.tertiary}>{item.station_name}</T></View>
          )}
        </View>
        <View style={[styles.tabs, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {([['cond', tx('autoReserve.manuAddEditor.conditions')], ['rec', tx('common.recordingSettings')]] as const).map(([k, l]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: tab === k ? theme.ink : 'transparent' }]}>
              <T mono size={10} w={700} color={tab === k ? theme.onInk : theme.mute}>{l}</T>
            </Pressable>
          ))}
        </View>
        {tab === 'cond' && <ManuAddConditions form={form} set={set} services={services.data} />}
        {tab === 'rec' && (
          <View style={[styles.recBox, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
            <RecSettingFormView value={form} onChange={setForm} recOpts={recOpts.data} tuners={tuners.data}
              original={item ? initRecSetting(item.rec_setting) : undefined} />
          </View>
        )}
        {err && <T mono size={11} color={RED}>{err}</T>}
        <Pressable onPress={() => void save()} disabled={!valid || saving}
          style={[styles.save, { backgroundColor: valid ? accent.secondary : theme.surface2, borderColor: theme.frame, boxShadow: valid ? shadow(theme, 3) : 'none' }]}>
          <T mono size={14} w={800} color={valid ? '#fff' : theme.mute}>{saving ? tx('common.saving') : item ? `PATCH /api/manu_add/${item.id}` : 'POST /api/manu_add'}</T>
        </Pressable>
        {item && (
          <Pressable onPress={() => void remove()} style={[styles.del, { backgroundColor: RED, borderColor: theme.frame }]}>
            <Trash s={15} c="#fff" />
            <T mono size={13} w={800} color="#fff">{`DELETE /api/manu_add/${item.id}`}</T>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 110 },
  body: { paddingHorizontal: 18, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tag: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  tabs: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10, borderWidth: 1 },
  tab: { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 7, alignItems: 'center' },
  recBox: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  save: { padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
  del: { padding: 13, borderRadius: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
