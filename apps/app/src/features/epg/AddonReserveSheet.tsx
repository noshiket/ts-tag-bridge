import { endMs, type AddonEvent, type VideoAddonParam } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Select } from '../../ui/inputs/Select';
import { Sheet } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * 番組表のアドオンの番組を録画アドオンへ予約する時の入力（元は録画アドオンが同梱する ui.jsx の ReserveForm）。
 * 出す項目は録画アドオンの params をそのまま描く（アドオンごとの画面は作らない）。
 * 空欄は送らない＝アドオン設定の既定値が使われる。既定値はアドオンに聞いて薄く出す（event='defaults'。答えなければ出さない）
 */
export function AddonReserveSheet({ recorder, e, node, onSubmit, onClose }: {
  recorder: { name: string; params?: VideoAddonParam[] } | null;
  e: AddonEvent | null;
  node: string | null;
  onSubmit: (extra: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const params = recorder?.params ?? [];
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [sending, setSending] = useState(false);
  const defs = useQuery({
    queryKey: ['addonDefaults', node ?? '', recorder?.name ?? ''],
    queryFn: async () => ((await api.autoAdd.fire<{ defaults?: Record<string, unknown> }>(recorder!.name, { event: 'defaults' }, node)).result?.defaults ?? {}),
    enabled: !!recorder && !!e, retry: false, staleTime: 60_000,
  });
  if (!recorder || !e) return <Sheet open={false} onClose={onClose} title=""><View /></Sheet>;
  const start = Date.parse(e.start_time);
  const d = defs.data ?? {};
  const input = [styles.input, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }];
  const submit = async () => {
    setSending(true);
    const out = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== '' && v != null));
    try { await onSubmit(out); } finally { setSending(false); }
  };
  return (
    <Sheet open onClose={onClose} title={e.title} subtitle={`${tx('epg.addonReserveTitle')}　${new Date(start).getMonth() + 1}/${new Date(start).getDate()} ${hm(start)} — ${hm(endMs(e))}`}>
      <ScrollView automaticallyAdjustKeyboardInsets style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.wrap}>
          {params.map((p) => (
            <View key={p.key} style={styles.row}>
              <T size={11} dim style={styles.label}>{p.label}</T>
              <View style={styles.grow}>
                {p.type === 'select' ? (
                  <Select label={p.label} value={String(vals[p.key] ?? '')} onChange={(v) => setVals((x) => ({ ...x, [p.key]: v }))}
                    options={(p.options ?? []).map((o) => ({ value: String(o), label: o === '' ? tx('epg.defaultOpt', { v: String(d[p.key] ?? '—') }) : String(o) }))} />
                ) : (
                  <TextInput value={vals[p.key] == null ? '' : String(vals[p.key])} keyboardType={p.type === 'number' ? 'numeric' : 'default'}
                    autoCapitalize="none" autoCorrect={false} placeholderTextColor={theme.mute}
                    placeholder={d[p.key] != null && d[p.key] !== '' ? tx('epg.defaultIs', { v: String(d[p.key]) }) : tx('epg.default')}
                    onChangeText={(v) => setVals((x) => ({ ...x, [p.key]: v }))} style={input} />
                )}
              </View>
            </View>
          ))}
          <T size={10} dim>{tx('epg.defaultNote')}</T>
          <View style={styles.btns}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: theme.frame }]}><T size={12} w={800}>{tx('common.stop')}</T></Pressable>
            <Pressable onPress={() => void submit()} disabled={sending} style={[styles.btn, { backgroundColor: accent.primary, borderColor: theme.frame }]}>
              <T size={12} w={800} color="#fff">{tx(sending ? 'epg.reserving' : 'epg.doReserve')}</T>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 560 },
  wrap: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: 130 },
  grow: { flex: 1, minWidth: 0 },
  input: { paddingVertical: 7, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, fontSize: 12, fontFamily: monoFamily[400] },
  btns: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
});
