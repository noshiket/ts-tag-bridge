import { storageUsed, type StorageInfo } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useReserveListState } from '../reservations/state';
import { Card, Loading, SRow } from './parts';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);
type Op = { status: 'running' | 'ok' | 'error'; message?: string };

/**
 * 設定の「EDCB」（元の SettingsEDCB）: 接続先、録画先の空き、チューナーごとの予約の数（押すとそのチューナーで絞った予約一覧へ）、
 * EPG の取得・読み直し。見ているサーバーのもの
 */
export function EdcbTab() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const { viewNode } = useViewNode();
  const [resState, setResState] = useReserveListState();
  const storage = useQuery({ queryKey: ['settings', viewNode ?? '', 'storage'], queryFn: () => api.settings.storage(viewNode) });
  const tuners = useQuery({ queryKey: ['tuners', viewNode ?? ''], queryFn: () => api.recSetting.tuners(viewNode) });
  const config = useQuery({ queryKey: ['settings', viewNode ?? '', 'config'], queryFn: () => api.settings.config(viewNode) });
  const edcbUrl = typeof config.data?.edcb_url === 'string' ? config.data.edcb_url : '';
  const [ops, setOps] = useState<Record<string, Op>>({});

  const run = async (k: string, fn: () => Promise<{ info?: string }>) => {
    setOps((p) => ({ ...p, [k]: { status: 'running' } }));
    try {
      const r = await fn();
      setOps((p) => ({ ...p, [k]: { status: 'ok', message: r?.info || tx('state.rec.encode_finish') } }));
      // 番組表を取り直す（元は番組表のキャッシュの版を上げていた）
      void qc.invalidateQueries({ queryKey: ['epg'] });
    } catch (e) {
      setOps((p) => ({ ...p, [k]: { status: 'error', message: e instanceof Error ? e.message : tx('reservations.list.alert.error') } }));
    }
  };
  const OPS = [
    { k: 'epg_cap', l: tx('settings.edcbTab.getEpgCapNow'), c: accent.tertiary, fn: () => api.settings.epgCap(viewNode) },
    { k: 'reload_epg', l: tx('settings.edcbTab.reloadReloadEpg'), c: accent.secondary, fn: () => api.settings.reloadEpg(viewNode) },
  ];

  return (
    <>
      <SectionTitle>{tx('settings.edcbTab.connection')}</SectionTitle>
      <Card>
        <SRow title={tx('settings.general.host')} titleEn="EDCBClient(url)" value={edcbUrl.replace(/^https?:\/\//, '') || '—'}
          onPress={edcbUrl ? () => void Linking.openURL(edcbUrl) : undefined} />
        <SRow title={tx('settings.edcbTab.cache')} value={tx('settings.general.csrf12h')} last />
      </Card>

      <SectionTitle>{tx('settings.edcbTab.storageGetStorage')}</SectionTitle>
      <Card>
        {storage.isLoading ? <Loading /> : !Array.isArray(storage.data) ? (
          // EDCB から配列が取れなかった時は、取れなかったことだけ出す
          <T size={12} dim style={styles.pad}>{tx('settings.edcbTab.couldntGetStorageInfo')}</T>
        ) : (storage.data as StorageInfo[]).map((s, i, a) => {
          const pct = storageUsed(s);
          return (
            <View key={s.id} style={[styles.pad, i < a.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
              <View style={styles.storageHead}>
                <T mono size={11} w={700} style={styles.shrink} numberOfLines={1}>{s.name}</T>
                <T mono size={10} dim>{s.text}</T>
              </View>
              <View style={[styles.bar, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct > 0.85 ? RED : accent.primary }} />
              </View>
            </View>
          );
        })}
      </Card>

      <SectionTitle>{tx('settings.edcbTab.tunersEnumTunerReserve')}</SectionTitle>
      <Card>
        {!tuners.data ? <Loading /> : tuners.data.map((t, i, a) => {
          const has = t.reserve_count > 0;
          return (
            <View key={t.tuner_id ?? i} style={[styles.tuner, i < a.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
              <View style={[styles.dot, { backgroundColor: has ? accent.primary : theme.mute, borderColor: theme.frame }]} />
              <T mono size={11} w={700} style={styles.grow}>{t.tuner_name}</T>
              <Pressable disabled={!has} onPress={() => {
                setResState({ filters: { ...resState.filters, tuner: t.tuner_name }, page: 0 });
                router.navigate('/reservations');
              }} style={[styles.count, { backgroundColor: has ? accent.primary : theme.surface2 }]}>
                <T mono size={9} w={800} color={has ? '#fff' : theme.mute}>{tx('common.items', { v0: t.reserve_count })}</T>
              </Pressable>
            </View>
          );
        })}
      </Card>

      <SectionTitle>{tx('settings.edcbTab.serverActions')}</SectionTitle>
      <View style={styles.ops}>
        {OPS.map((b) => {
          const op = ops[b.k];
          const dot = op?.status === 'ok' ? accent.quaternary : op?.status === 'error' ? RED : op?.status === 'running' ? accent.tertiary : b.c;
          return (
            <Pressable key={b.k} onPress={() => void run(b.k, b.fn)}
              style={[styles.op, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
              <View style={[styles.opDot, { backgroundColor: dot }]} />
              <T mono size={10} w={700} style={styles.center}>{b.l}</T>
              {op && <T mono size={8} dim style={styles.center}>{op.status === 'running' ? tx('common.running') : `${op.status === 'ok' ? '✓' : '✗'} ${op.message ?? ''}`}</T>}
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: 11, paddingHorizontal: 13 },
  storageHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  shrink: { flexShrink: 1 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', borderWidth: 1 },
  tuner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  grow: { flex: 1 },
  count: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4 },
  ops: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  op: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', gap: 4 },
  opDot: { width: 6, height: 6, borderRadius: 3 },
  center: { textAlign: 'center', lineHeight: 14 },
});
