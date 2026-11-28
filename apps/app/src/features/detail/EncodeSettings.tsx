import {
  addonParamValue, canSaveEncodeInfo, defaultEncodeInfo, delegateNodeOf, effectiveInfo, encodeInfoBody, encoderChoices, fillAddonDefaults,
  fillAmzDefaults,
  selectEncoder, selectedAddon, setAddonParam, updateEffective, type EncodeInfo,
} from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { Select } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';
import { AmzPresetFields } from './AmzPresetFields';
import { Field, withBlank } from './encodeFields';

/** 保存してある設定は JSON の文字列で届くこともある */
const parseInfo = (v: unknown): EncodeInfo | null => {
  if (v && typeof v === 'object') return v as EncodeInfo;
  if (typeof v === 'string') { try { return JSON.parse(v) as EncodeInfo; } catch { return null; } }
  return null;
};

/**
 * 録画のエンコードの設定（元の detail_rec.jsx の ENCODE）。エンコーダー（設定のもの・アドオン・他のサーバーへ送る）を選び、
 * Amatsukaze ならサーバー・プリセット・入力、アドオンならその項目を入れて保存する。保存した後「エンコードキューに追加」で使われる
 */
export function EncodeSettings({ dbRecId, saved, node }: { dbRecId: number | null; saved: unknown; node: string | null }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const options = useQuery({ queryKey: ['encodeOptions', node ?? ''], queryFn: () => api.encodeInfo.options(node) });
  const [info, setInfo] = useState<EncodeInfo | null>(() => parseInfo(saved));
  const [done, setDone] = useState(false);
  const o = options.data ?? {};
  // 保存した設定が無ければ、選択肢が届いた時に既定を入れる
  useEffect(() => { if (options.data) setInfo((cur) => cur ?? defaultEncodeInfo(options.data!)); }, [options.data]);
  const delegate = delegateNodeOf(info);
  const remote = useQuery({ queryKey: ['encodeOptions', delegate ?? ''], queryFn: () => api.encodeInfo.options(delegate), enabled: !!delegate });
  const eff = effectiveInfo(info);
  const servers = (delegate ? remote.data?.amatsukaze_servers : o.amatsukaze_servers) ?? [];
  const amzOn = eff?.encode_type === 'amatsukaze_servers';
  const profiles = useQuery({
    queryKey: ['amzProfiles', eff?.encode_link ?? '', delegate ?? node ?? ''],
    queryFn: () => api.encodeInfo.amzProfiles(eff!.encode_link, delegate || node),
    enabled: amzOn && !!eff?.encode_link,
  });
  const addon = selectedAddon(info, o);
  // 空いている所（サーバー・プリセット・プロファイル・アドオンの項目）には一番上を入れる。
  // 選び直した時・「〜へ送信」の送り先の選択肢が後から届いた時も、空のまま残さない
  useEffect(() => {
    const next = fillAmzDefaults(eff, servers, profiles.data ?? []);
    if (next) setInfo((cur) => updateEffective(cur, () => next));
  }, [eff, servers, profiles.data]);
  useEffect(() => {
    const next = fillAddonDefaults(info, addon);
    if (next) setInfo(next);
  }, [info, addon]);
  const canSave = canSaveEncodeInfo(info, o, dbRecId != null);
  const setEff = (fn: (e: EncodeInfo) => EncodeInfo) => setInfo((cur) => updateEffective(cur, fn));
  const ep = (eff?.encode_preset ?? {}) as Record<string, unknown> & { outputs?: Record<string, unknown> };
  const setEp = (patch: Record<string, unknown>) => setEff((e) => ({ ...e, encode_preset: { ...(e.encode_preset ?? {}), ...patch } }));
  const input = [styles.input, { borderColor: theme.line, backgroundColor: theme.surface, color: theme.ink }];
  const save = async () => {
    if (dbRecId == null) return;
    try {
      await api.encodeInfo.save(dbRecId, encodeInfoBody(info), node);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e) {
      alert(tx('common.saveFailed', { v0: e instanceof Error ? e.message : String(e) }));
    }
  };
  const choices = encoderChoices(o);
  const sel = eff?.encode_link ? servers.find((s) => s.url === eff.encode_link) : undefined;

  return (
    <View style={[styles.wrap, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      <T mono size={10} w={700} dim style={styles.title}>{tx('detail.encodeSettings.encodeSettings')}</T>
      <Field label={tx('detail.encodeSettings.encoder')}>
        <View style={styles.pills}>
          {choices.map((c) => {
            const on = info?.encode_type === c.type;
            return (
              <Pressable key={c.type} onPress={() => setInfo((cur) => selectEncoder(cur, c.type))}
                style={[styles.pill, { borderColor: on ? accent.primary : theme.line, backgroundColor: on ? accent.primary : 'transparent' }]}>
                <T mono size={10} color={on ? '#fff' : theme.ink}>{c.label}</T>
              </Pressable>
            );
          })}
          {choices.length === 0 && <T size={10} dim>{tx('detail.encodeSettings.noSetting')}</T>}
        </View>
      </Field>

      {addon && (
        <View style={styles.mb8}>
          {!!addon.description && <T mono size={9} dim style={styles.mb6}>{addon.description}</T>}
          {(addon.params ?? []).map((p) => {
            const v = addonParamValue(info, p);
            const set = (x: unknown) => setInfo((cur) => setAddonParam(cur, p.key, x));
            return (
              <View key={p.key} style={styles.paramRow}>
                <T mono size={10} dim style={styles.paramLabel}>{p.label}{p.required ? <T size={10} color="#ef4444"> *</T> : null}</T>
                {p.type === 'bool' ? (
                  <Pressable onPress={() => set(!v)} accessibilityRole="checkbox" accessibilityState={{ checked: !!v }}
                    style={[styles.check, { borderColor: theme.frame, backgroundColor: v ? accent.primary : theme.surface }]}>
                    {!!v && <T size={11} w={700} color="#fff">✓</T>}
                  </Pressable>
                ) : p.type === 'select' ? (
                  <View style={styles.grow}><Select label={p.label} value={String(v)} onChange={set} options={(p.options ?? []).map((x) => ({ value: String(x), label: String(x) }))} /></View>
                ) : (
                  <TextInput value={String(v ?? '')} keyboardType={p.type === 'number' ? 'numeric' : 'default'} autoCapitalize="none"
                    onChangeText={(x) => set(p.type === 'number' ? (x === '' ? '' : Number(x)) : x)} style={input} />
                )}
              </View>
            );
          })}
        </View>
      )}

      {delegate && (
        <T mono size={9} dim style={styles.mb6}>{tx('detail.encodeSettings.encodeSettingsDestinationRecording', { v0: delegate, v1: remote.data ? '' : tx('detail.encodeSettings.fetching') })}</T>
      )}

      {amzOn && (
        <Field label={tx('common.servers')}>
          <Select label={tx('common.servers')} value={eff?.encode_link ?? ''} onChange={(url) => setEff((e) => ({ ...e, encode_link: url, encode_preset: null }))}
            options={withBlank(servers.map((s) => ({ value: s.url, label: s.name ? `${s.name} (${s.url})` : s.url })), tx('detail.encodeSettings.select'))} />
        </Field>
      )}

      {amzOn && !!eff?.encode_link && (
        <AmzPresetFields server={sel} preset={ep} profiles={profiles.data ?? []} inputStyle={input}
          onPreset={(p) => setEff((e) => ({ ...e, encode_preset: p }))} onPatch={setEp} />
      )}

      <Pressable onPress={() => void save()} disabled={!canSave}
        style={[styles.save, { backgroundColor: done ? oklch(0.6, 0.2, 145) : !canSave ? theme.line : accent.primary }]}>
        <T mono size={12} w={700} color="#fff">{done ? tx('detail.encodeSettings.saved') : tx('detail.encodeSettings.saveSaveEncodeInfo')}</T>
      </Pressable>
      {dbRecId == null && <T size={9} dim style={styles.center}>{tx('detail.encodeSettings.cantSaveNotDb')}</T>}
    </View>
  );
}


const styles = StyleSheet.create({
  wrap: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5 },
  title: { letterSpacing: 1, marginBottom: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pill: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5 },
  mb6: { marginBottom: 6 },
  mb8: { marginBottom: 8 },
  paramRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  paramLabel: { width: 96 },
  grow: { flex: 1 },
  check: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  save: { padding: 9, borderRadius: 9, alignItems: 'center' },
  center: { textAlign: 'center', marginTop: 4 },
});
