import { initRecSetting, type AutoAddRule, type PendingAutoAdd } from '@tstag/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AutoAddPreview } from './AutoAddPreview';
import { useAutoAddEditor } from './useAutoAddEditor';
import { NodeBadge } from '../../library/NodeSwitcher';
import { RecSettingFormView } from '../../recsetting/RecSettingForm';
import { Trash } from '../../../ui/parts/Icons';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { AutoAddConditions } from './AutoAddConditions';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);

/**
 * EPG キーワード自動予約の編集（元の AutoAddDetailScreen の中身）。検索条件と録画設定の2つのタブ。
 * 試しの検索で当たる番組を見て、押すと予約・スキップ。保存・削除すると一覧へ戻る。状態と保存は useAutoAddEditor
 */
export function AutoAddEditor({ item, pending, node, back }: { item: AutoAddRule | null; pending: PendingAutoAdd | null; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const a = useAutoAddEditor(item, pending, node, back);
  const { form, set, saving } = a;
  const [tab, setTab] = useState<'search' | 'rec'>('search');

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TopBar title={tx('common.autoReserve')} onBack={back} afterTitle={<NodeBadge node={node} />} />
      <View style={styles.body}>
        <View style={styles.head}>
          {item ? <Tag bg={theme.surface2} fg={theme.mute}>{`id:${item.id}`}</Tag> : <Tag bg={`${accent.secondary}33`} fg={accent.secondary}>NEW</Tag>}
          {!!item?.addCount && <Tag bg={`${accent.primary}33`} fg={accent.primary} bold>{`×${item.addCount}回マッチ`}</Tag>}
          <View style={styles.enable}>
            <T mono size={9} dim>{tx('reservations.list.auto')}</T>
            <Pressable onPress={() => set('disableFlag', !form.disableFlag)}
              style={[styles.enableBtn, { backgroundColor: form.disableFlag ? RED : accent.primary, borderColor: theme.frame }]}>
              <T mono size={10} w={800} color="#fff">{form.disableFlag ? tx('common.off') : tx('common.enabled')}</T>
            </Pressable>
          </View>
        </View>

        <View style={[styles.tabs, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {([['search', tx('autoReserve.autoAddEditor.searchConditions')], ['rec', tx('common.recordingSettings')]] as const).map(([k, l]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: tab === k ? theme.ink : 'transparent' }]}>
              <T mono size={10} w={700} color={tab === k ? theme.onInk : theme.mute}>{l}</T>
            </Pressable>
          ))}
        </View>

        {tab === 'search' && (
          <>
            <AutoAddConditions form={form} set={set} services={a.services.data} guideChans={a.guideChans.data ?? []}
              recorderLabel={a.recorder.data ? a.recorder.data.label || a.recorder.data.name : null} addonChs={a.addonChs} setAddonChs={a.setAddonChs} />
            <AutoAddPreview form={form} node={node} addonMode={a.addonMode} addonName={a.addonName} addonChs={a.addonChs} reserves={a.reserves.data ?? []}
              onReserved={() => void a.reserves.refetch()} />
          </>
        )}

        {tab === 'rec' && (
          <View style={[styles.recBox, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
            <RecSettingFormView value={form} onChange={a.setForm} recOpts={a.recOpts.data} tuners={a.tuners.data}
              original={item ? initRecSetting(item.rec_setting) : undefined} />
          </View>
        )}

        {a.err && <T mono size={11} color={RED}>{a.err}</T>}
        <Pressable onPress={() => void a.save()} disabled={saving}
          style={[styles.save, { backgroundColor: saving ? theme.surface2 : accent.secondary, borderColor: theme.frame, boxShadow: saving ? 'none' : shadow(theme, 3) }]}>
          <T mono size={14} w={800} color={saving ? theme.mute : '#fff'}>{saving ? tx('common.saving') : item ? `PATCH /api/auto_add/${item.id}` : 'POST /api/auto_add'}</T>
        </Pressable>
        {item && (
          <Pressable onPress={() => void a.remove()} style={[styles.del, { backgroundColor: RED, borderColor: theme.frame }]}>
            <Trash s={15} c="#fff" />
            <T mono size={13} w={800} color="#fff">{`DELETE /api/auto_add/${item.id}`}</T>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function Tag({ children, bg, fg, bold }: { children: string; bg: string; fg: string; bold?: boolean }) {
  return <View style={[styles.tag, { backgroundColor: bg }]}><T mono size={9} w={bold ? 700 : 400} color={fg}>{children}</T></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 110 },
  body: { paddingHorizontal: 18, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  tag: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4 },
  enable: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  enableBtn: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5 },
  tabs: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 10, borderWidth: 1 },
  tab: { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 7, alignItems: 'center' },
  recBox: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  save: { padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
  del: { padding: 13, borderRadius: 13, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
