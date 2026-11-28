import { addonDraft, addonSettingParams, canFireAddon, type AddonDraft, type AddonSetting } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const WARN_BG = oklch(0.95, 0.06, 85);
const WARN_BORDER = oklch(0.75, 0.15, 85);
const WARN_INK = oklch(0.42, 0.14, 65);
const WARN_SUB = oklch(0.42, 0.1, 65);

/**
 * 設定の「アドオン」（元の SettingsAddons）: server/addon/ のアドオンごとに有効・無効と設定値、足りない追加ライブラリの導入、
 * 自己診断の結果、試しに動かす（通知・設定タブのアドオンだけ）。見ているサーバーのもの
 */
export function AddonsTab() {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const { viewNode } = useViewNode();
  const list = useQuery({ queryKey: ['settings', viewNode ?? '', 'addons'], queryFn: () => api.settings.addons(viewNode) });
  const [draft, setDraft] = useState<Record<string, AddonDraft>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // 読み直したら編集の値も読んだ値にする（元と同じ）
  useEffect(() => {
    if (list.data) setDraft(Object.fromEntries(list.data.map((a) => [a.name, addonDraft(a)])));
  }, [list.data]);

  const say = (name: string, m: string) => setMsg((p) => ({ ...p, [name]: m }));
  const act = async (a: AddonSetting, fn: () => Promise<string>) => {
    setBusy(a.name);
    say(a.name, '');
    try { say(a.name, await fn()); } catch (e) { say(a.name, e instanceof Error ? e.message : tx('common.failed2')); } finally { setBusy(null); }
  };
  const save = (a: AddonSetting) => act(a, async () => { await api.settings.saveAddon(a.name, draft[a.name]!, viewNode); return tx('common.saved'); });
  const install = (a: AddonSetting) => act(a, async () => {
    const r = await api.settings.installAddonRequirements(a.name, viewNode);
    await list.refetch();
    return r.ok ? tx('settings.general.installed') : tx('common.failed', { v0: (r.log || '').slice(-200) });
  });
  const fire = (a: AddonSetting) => act(a, async () => {
    const r = await api.settings.fireAddon(a.name, viewNode);
    return r.ok ? (typeof r.result === 'string' && r.result ? r.result : tx('settings.addonsTab.done')) : tx('common.failed', { v0: r.error });
  });
  const setParam = (name: string, key: string, v: unknown) =>
    setDraft((d) => ({ ...d, [name]: { ...d[name]!, params: { ...d[name]!.params, [key]: v } } }));

  return (
    <View>
      <SectionTitle>{tx('common.addOns')}</SectionTitle>
      <T mono size={10} dim style={styles.mb12}>
        server/addon/ に置いたアドオンの一覧です。無効にしたアドオンは動画カードの実行メニューやエンコーダーの選択肢にも出なくなります。設定は server/data/addon/&lt;名前&gt;.json に保存されます。
      </T>
      {list.isLoading && <T size={11} dim>{tx('common.loading2')}</T>}
      {list.error && <T size={10} color="#ef4444">{tx('settings.addonsTab.failedLoad', { v0: list.error.message })}</T>}
      {list.data?.length === 0 && <T size={11} dim>{tx('settings.addonsTab.noAddOnsHere')}</T>}
      {(list.data ?? []).map((a) => {
        const d = draft[a.name];
        const m = msg[a.name];
        return (
          <View key={a.name} style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={styles.head}>
              <View style={styles.grow}>
                <T size={12} w={800}>{a.label}</T>
                <T mono size={9} dim>{`${a.name} · ${a.target ?? ''}`}</T>
              </View>
              {!a.error && d && <Btn on={d.enabled} onPress={() => setDraft((p) => ({ ...p, [a.name]: { ...d, enabled: !d.enabled } }))}>{d.enabled ? tx('common.enabled') : tx('common.off')}</Btn>}
            </View>
            {!!a.error && <T size={10} color="#ef4444">{tx('settings.addonsTab.loadError', { v0: a.error })}</T>}
            {/* 追加ライブラリが入っていない（読み込みに失敗しているアドオンでも出す。入っていなくて読めないことがある） */}
            {a.requirements && !a.requirements.ok && (
              <View style={styles.warn}>
                <T size={10} w={700} color={WARN_INK}>{tx('settings.addonsTab.extraLibrariesNotInstalled')}</T>
                <T mono size={9} color={WARN_SUB} style={styles.warnList}>{a.requirements.items.filter((i) => !i.installed).map((i) => i.line).join(' / ')}</T>
                <Btn bg={oklch(0.6, 0.16, 65)} disabled={busy === a.name} onPress={() => void install(a)}>{busy === a.name ? tx('settings.addonsTab.installing') : tx('settings.addonsTab.install')}</Btn>
              </View>
            )}
            {a.requirements?.ok && a.requirements.items.length > 0 && (
              <T mono size={9} dim style={styles.mt4}>{tx('settings.addonsTab.extraLibraries', { v0: a.requirements.items.map((i) => `${i.name} ${i.version || ''}`.trim()).join(' / ') })}</T>
            )}
            {/* アドオン自身の診断（日本語フォント・外部コマンドなど） */}
            {a.health && !a.health.ok && (
              <View style={styles.warn}>
                <T size={10} w={700} color={WARN_INK}>{`⚠ ${a.health.message ?? ''}`}</T>
                {!!a.health.hint && <T mono size={9} color={WARN_SUB} style={styles.hint}>{a.health.hint}</T>}
              </View>
            )}
            {a.health?.ok && !!a.health.message && <T mono size={9} dim style={styles.mt4}>{`✓ ${a.health.message}`}</T>}
            {!!a.description && <T size={10} dim style={styles.mb6}>{a.description}</T>}
            {!!a.events?.length && <T mono size={9} dim style={styles.mb8}>{tx('settings.addonsTab.subscribes', { v0: a.events.join(' / ') })}</T>}
            {d && addonSettingParams(a).map((p) => (
              <View key={p.key} style={styles.mb8}>
                <T mono size={9} dim style={styles.mb3}>{`${p.label}${p.required ? ' *' : ''}`}</T>
                {p.type === 'bool' ? (
                  <Btn on={!!d.params[p.key]} onPress={() => setParam(a.name, p.key, !d.params[p.key])}>{d.params[p.key] ? 'ON' : 'OFF'}</Btn>
                ) : (
                  <TextInput value={d.params[p.key] == null ? '' : String(d.params[p.key])} autoCapitalize="none" autoCorrect={false}
                    keyboardType={p.type === 'number' ? 'numeric' : 'default'}
                    onChangeText={(v) => setParam(a.name, p.key, p.type === 'number' ? Number(v) : v)}
                    placeholder={p.default != null ? String(p.default) : ''} placeholderTextColor={theme.mute}
                    style={[styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
                )}
              </View>
            ))}
            {!a.error && (
              <View style={styles.actions}>
                <Btn on disabled={busy === a.name} onPress={() => void save(a)}>{tx('common.save')}</Btn>
                {canFireAddon(a) && <Btn disabled={busy === a.name} onPress={() => void fire(a)}>{tx('settings.addonsTab.testRun')}</Btn>}
                {!!m && <T mono size={9} color={m.startsWith(tx('state.rec.encode_error')) ? '#ef4444' : theme.mute} style={styles.shrink}>{m}</T>}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Btn({ children, on, bg, disabled, onPress }: { children: string; on?: boolean; bg?: string; disabled?: boolean; onPress: () => void }) {
  const { theme, accent } = useTheme();
  const fill = bg ?? (on ? accent.primary : 'transparent');
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, { backgroundColor: fill, borderColor: theme.line, opacity: disabled ? 0.6 : 1 }]}>
      <T mono size={10} w={700} color={bg || on ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mb3: { marginBottom: 3 },
  mb6: { marginBottom: 6 },
  mb8: { marginBottom: 8 },
  mb12: { marginBottom: 12 },
  mt4: { marginTop: 4 },
  box: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  warn: { marginTop: 6, marginBottom: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, backgroundColor: WARN_BG, borderColor: WARN_BORDER, alignItems: 'flex-start' },
  warnList: { marginTop: 3, marginBottom: 6 },
  hint: { marginTop: 3, lineHeight: 15 },
  input: { paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  btn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1 },
});
