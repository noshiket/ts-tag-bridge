import type { MsgKey } from '@tstag/core';
import { groupLogos, logoDisplaySize } from '@tstag/core';
import { useApi, useServices } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Fragment, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const BANDS = [['terr', 'common.terrestrial'], ['bs', 'epg.band.bs'], ['cs', 'epg.band.cs']] as const satisfies readonly (readonly [string, MsgKey])[];

/**
 * 設定の「ロゴ」（元の SettingsLogo）: EDCB からロゴを取り込む・キャッシュを消す、持っているロゴを帯ごとに並べる。
 * 「?」で BS/CS のロゴが取れない時の EDCB の設定を出す（元はマウスを乗せると出る。ここは押すと開く）
 */
export function LogoTab() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const { viewNode } = useViewNode();
  const logos = useQuery({ queryKey: ['settings', viewNode ?? '', 'logos'], queryFn: () => api.settings.logoList(viewNode) });
  const services = useServices(viewNode);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState('');
  const [hint, setHint] = useState(false);
  const [help, setHelp] = useState(false);
  const names = useMemo(() => new Map((services.data ?? []).map((s) => [`${s.onid}-${s.sid}`, s.service_name])), [services.data]);
  const grouped = groupLogos(logos.data ?? []);
  const reload = () => { void logos.refetch(); void qc.invalidateQueries({ queryKey: ['epg', 'logos'] }); };

  const doFetch = async () => {
    setFetching(true);
    setMsg(tx('common.fetching'));
    try {
      const r = await api.settings.fetchEdcbLogos(viewNode);
      setMsg(tx('common.savedSkipped', { v0: r.saved.length, v1: r.skipped.length, v2: r.errors.length ? tx('settings.logoTab.errors', { n: r.errors.length }) : '' }));
      setHint(r.saved.length === 0 && r.skipped.length === 0);
      reload();
    } catch (e) {
      setMsg(tx('common.failed', { v0: e instanceof Error ? e.message : e }));
    } finally {
      setFetching(false);
    }
  };
  const doClear = async () => {
    try { const r = await api.settings.clearLogoCache(viewNode); setMsg(tx('settings.logoTab.cacheCleared', { v0: r.cleared })); reload(); } catch (e) { setMsg(tx('common.failed', { v0: e instanceof Error ? e.message : e })); }
  };
  const ops = [
    { l: tx('settings.logoTab.fetchFetchEdcb'), c: accent.primary, fn: doFetch, dis: fetching },
    { l: tx('settings.logoTab.clearCacheClearCache'), c: accent.quaternary, fn: doClear, dis: false },
  ];
  const box = [styles.note, { backgroundColor: theme.surface2, borderColor: theme.line }];

  return (
    <>
      <View style={styles.titleRow}>
        <SectionTitle>{tx('common.actions')}</SectionTitle>
        <Pressable onPress={() => setHelp(!help)} accessibilityLabel={tx('settings.logoTab.whenLogosCantFetched')} style={[styles.q, { borderColor: theme.line }]}>
          <T size={10} w={700} dim>?</T>
        </Pressable>
      </View>
      {help && (
        <View style={box}>
          <T mono size={10} w={700} style={styles.mb4}>{tx('settings.logoTab.settingsWhenBsCs')}</T>
          <T mono size={10} dim style={styles.lh}>
            <T mono size={10} w={700} dim>{tx('settings.logoTab.settingsRecordingAppEpgdatacap')}</T>{tx('settings.logoTab.setLogoTypesSave', { v0: '\n' })} <T mono size={10} color={accent.primary}>63</T> に設定{'\n'}
            <T mono size={10} dim style={styles.faint}>EpgDataCap_Bon.ini: SaveLogoTypeFlags=63</T>{'\n\n'}
            <T mono size={10} w={700} dim>{tx('settings.logoTab.settingsCaptureStartTime')}</T>　<T mono size={10} w={700} color={accent.primary}>{tx('settings.logoTab.mostImportant')}</T>{'\n'}
            {tx('settings.logoTab.leastOneSlotTurn', { v0: '\n', v1: '\n' })}
            <T mono size={10} dim style={styles.faint}>{tx('settings.logoTab.epgtimersrvIniBasiconlyflags0')}</T>{'\n\n'}
            <T mono size={10} w={700} dim>{tx('settings.logoTab.settingsCapture')}</T>{'\n'}「基本情報のみ取得するネットワーク（視聴・録画中）」の{'\n'}BS・CS1・CS2・CS3 をすべてオフにする{'\n'}
            <T mono size={10} dim style={styles.faint}>EpgDataCap_Bon.ini: EpgCapBack*BasicOnly=0</T>
          </T>
        </View>
      )}
      <View style={[styles.ops, { marginBottom: msg ? 8 : 16 }]}>
        {ops.map((b, i) => (
          <Pressable key={i} onPress={() => void b.fn()} disabled={b.dis}
            style={[styles.op, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
            <View style={[styles.dot, { backgroundColor: b.dis ? accent.tertiary : b.c }]} />
            <T mono size={10} w={700} style={styles.center}>{b.l}</T>
          </Pressable>
        ))}
      </View>
      {hint && (
        <View style={box}>
          <T mono size={10} dim style={styles.lh}>
            {tx('settings.logoTab.ifSLogoTypes')}
            <T mono size={10} dim style={styles.faint}>EpgDataCap_Bon.ini: SaveLogoTypeFlags=63</T>
          </T>
        </View>
      )}
      {!!msg && <View style={[box, styles.mb16]}><T mono size={11} dim>{msg}</T></View>}

      {!logos.data ? <T mono size={11} dim>{tx('common.loading')}</T> : BANDS.map(([k, l]) => {
        const items = grouped[k];
        return (
          <Fragment key={k}>
            <SectionTitle>{tx('settings.logoTab.stations', { v0: tx(l), v1: items.length })}</SectionTitle>
            {items.length === 0 ? (
              <View style={[styles.none, { backgroundColor: theme.surface, borderColor: theme.frame }]}><T mono size={11} dim>{tx('settings.logoTab.noLogo')}</T></View>
            ) : (
              <View style={styles.grid}>
                {items.map((g) => {
                  const size = logoDisplaySize(g);
                  return (
                    <View key={`${g.onid}-${g.sid}`} style={[styles.logo, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                      {/* ロゴは局で決まるので、いつもこのサーバーのものを出す（元と同じ） */}
                      <Image source={{ uri: api.client.url(`/api/logo?onid=${g.onid}&sid=${g.sid}&v=3`), headers: api.client.authHeaders() }}
                        style={{ width: size.w, height: size.h }} contentFit="contain" cachePolicy="memory-disk" />
                      <T size={9} w={700} numberOfLines={1} style={styles.name}>{names.get(`${g.onid}-${g.sid}`) ?? `sid:${g.sid}`}</T>
                      <T mono size={8} dim>{g.sizes.map((s) => `${s.w}x${s.h}`).join(' · ')}</T>
                    </View>
                  );
                })}
              </View>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  q: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  note: { marginBottom: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  mb4: { marginBottom: 4 },
  mb16: { marginBottom: 16 },
  lh: { lineHeight: 17 },
  faint: { opacity: 0.65 },
  ops: { flexDirection: 'row', gap: 8 },
  op: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  center: { textAlign: 'center', lineHeight: 14 },
  none: { marginBottom: 16, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  logo: { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, minWidth: 64 },
  name: { maxWidth: 80, textAlign: 'center' },
});
