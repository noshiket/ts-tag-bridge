import { SECRET_MASK } from '@tstag/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CONFIG_ERR, SecretRow, SmallBtn, configStyles as cs } from './configFields';
import { Fold } from './serverCardFields';
import type { ConfigEditorState } from './useConfigEditor';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** ④ 相手のサーバーでやること。このサーバーの名前・URL・合言葉を入れた手順にして出す */
export function PartnerSteps({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const name = String(c.val('federation.node_id') || '');
  const token = c.val('federation.fed_token');
  const plainToken = token && token !== SECRET_MASK ? String(token) : '';
  const sends = !!c.val('federation.library_peer.url');
  const line = (n: number, text: string, extra?: ReactNode) => (
    <View style={styles.line}>
      <T size={10} w={800}>{`${n}.`}</T>
      <View style={styles.grow}><T size={10} style={styles.lh}>{text}</T>{extra}</View>
    </View>
  );
  return (
    <View style={[styles.box, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      <T size={12} w={800} style={styles.mb4}>{tx('settings.federationGuide.otherServer')}</T>
      <T size={9} dim style={[styles.lh, styles.mb6]}>{tx('settings.federationGuide.otherServersAppOpen')}</T>
      {line(1, tx('settings.federationGuide.pasteSameValueServer'),
        plainToken ? <SmallBtn onPress={() => void c.copy('token2', plainToken)}>{c.copied === 'token2' ? tx('common.copied') : tx('settings.federationGuide.copySharedSecret')}</SmallBtn> : null)}
      {sends && line(2, tx('settings.federationGuide.ifOtherServerDestination'))}
      {line(sends ? 3 : 2, tx('settings.federationGuide.viewServerThereToo', { v0: name || tx('settings.federation.nameOf1'), v1: c.thisUrl || tx('settings.federation.thisUrl') }),
        c.thisUrl ? <SmallBtn onPress={() => void c.copy('url', c.thisUrl)}>{c.copied === 'url' ? tx('common.copied') : tx('settings.federationGuide.copy')}</SmallBtn> : null)}
      {line(sends ? 4 : 3, tx('settings.federationGuide.pressSaveSettingsThere'))}
    </View>
  );
}

/** あまり使わない物（送り先だけの合言葉・パターンの同期） */
export function FederationExtras({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const r = c.syncResult;
  return (
    <View style={cs.pad}>
      <Fold title={tx('settings.federationGuide.useDifferentSecretDestination')}>
        <SecretRow c={c} label={tx('settings.federationGuide.destinationOnlySecret')} en="federation.library_peer.fed_token" k="federation.library_peer.fed_token"
          hint={tx('settings.federationGuide.onlyWhenDestinationUses')} />
      </Fold>
      <Fold title={tx('settings.federationGuide.patternSync')}>
        <T size={9} dim style={[styles.lh, styles.mb6]}>
          {tx('settings.federationGuide.addingEditingPatternsProgram')}
        </T>
        <Pressable onPress={() => void c.syncPatterns()} disabled={c.syncing} style={[cs.wide, { backgroundColor: theme.surface2, borderColor: theme.line, opacity: c.syncing ? 0.6 : 1 }]}>
          <T size={10} w={700}>{c.syncing ? tx('settings.federationGuide.syncing') : tx('settings.federationGuide.resendAllPatterns')}</T>
        </Pressable>
        {r && (
          <View style={cs.mt6}>
            {'error' in r && typeof r.error === 'string'
              ? <T size={9} color={CONFIG_ERR}>{tx('common.failed', { v0: r.error })}</T>
              : Object.entries(r as Record<string, { ok: boolean; sids: number; error?: string }>).map(([name, x]) => (
                <T key={name} size={9} dim>{`${name}: ${x.ok ? tx('settings.federation.ok', { n: x.sids }) : tx('settings.federation.fail', { n: x.sids, e: x.error })}`}</T>
              ))}
          </View>
        )}
      </Fold>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 13, marginTop: 14, padding: 10, borderRadius: 10, borderWidth: 1, gap: 6 },
  line: { flexDirection: 'row', gap: 6 },
  grow: { flex: 1, gap: 4 },
  lh: { lineHeight: 14 },
  mb4: { marginBottom: 4 },
  mb6: { marginBottom: 6 },
});
