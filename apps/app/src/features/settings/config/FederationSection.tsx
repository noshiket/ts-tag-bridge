import { SECRET_MASK, federationRole, verifyTls } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { ConfigRow, SecretRow, SmallBtn, TestButton, configStyles as cs } from './configFields';
import { FederationExtras, PartnerSteps } from './FederationGuide';
import type { ConfigEditorState } from './useConfigEditor';
import { ArrayCardEditor } from '../ArrayCardEditor';
import { CfgSection } from '../CfgSection';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 手順の見出し（① このサーバーの名前 など） */
function Step({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <View style={styles.step}>
      <T size={12} w={800}>{`${n} ${title}`}</T>
      <T size={9} dim style={styles.lh}>{note}</T>
    </View>
  );
}

/**
 * サーバー間連携: やることの順に並べる（① 名前 → ② 合言葉 → ③ 何をするか → ④ 相手のサーバーでやること）。
 * 設定の言葉（fed_token など）ではなく、何のための物かで書く
 */
export function FederationSection({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const role = federationRole(c.val);
  const roleColor = role.role === 'sender' ? [oklch(0.94, 0.06, 250), oklch(0.38, 0.12, 250)] : role.role === 'receiver' ? [oklch(0.94, 0.06, 150), oklch(0.38, 0.12, 150)] : [theme.surface2, theme.mute];
  const token = c.val('federation.fed_token');
  const plainToken = token && token !== SECRET_MASK ? String(token) : '';
  return (
    <CfgSection title={tx('settings.federationSection.serverFederation')}>
      <View style={[styles.role, { backgroundColor: roleColor[0] }]}><T size={11} w={700} color={roleColor[1]}>{role.label}</T></View>
      <T size={9} dim style={[cs.pad, styles.lh]}>
        {tx('settings.federationSection.twoMoreServersGather')}
      </T>

      <Step n="①" title={tx('settings.federationSection.serversName')} note={tx('settings.federationSection.nameShownOtherServer')} />
      <ConfigRow c={c} label={tx('library.musicSort.name')} en="federation.node_id" k="federation.node_id" placeholder={tx('settings.federationSection.eGLivingRoom')} />

      <Step n="②" title={tx('settings.federationSection.chooseSharedSecret')} note={tx('settings.federationSection.useSameValueEvery')} />
      <SecretRow c={c} label={tx('settings.federationSection.sharedSecretBetweenServers')} en="federation.fed_token" k="federation.fed_token" />
      <View style={[cs.pad, styles.row]}>
        {plainToken
          ? <SmallBtn onPress={() => void c.copy('token', plainToken)}>{c.copied === 'token' ? tx('common.copied') : tx('settings.federationSection.copySecret')}</SmallBtn>
          : <T size={9} dim style={[styles.grow, styles.lh]}>{token ? tx('settings.federationSection.savedSecretCantShown') : tx('settings.federationSection.notSetYet')}</T>}
      </View>

      <Step n="③-A" title={tx('settings.federationSection.sendEncodedVideosAnother')} note={tx('settings.federationSection.fillingAddsMasterSend')} />
      <ConfigRow c={c} label={tx('settings.federationSection.destinationName')} en="federation.library_peer.name" k="federation.library_peer.name" hint={tx('settings.federationSection.destinationsName')} />
      <ConfigRow c={c} label={tx('settings.federationSection.destination')} en="federation.library_peer.url" k="federation.library_peer.url" placeholder="https://..." hint={tx('settings.federationSection.openDestinationsApp')} />
      <ConfigRow c={c} label={tx('settings.federationSection.verifyCertificate')} en="federation.library_peer.verify_tls" k="federation.library_peer.verify_tls" type="bool" fallback="true"
        hint={tx('settings.federationSection.normallyOffOnlySelf')} />
      <View style={cs.pad}>
        <TestButton c={c} k="fed_peer" body={{
          type: 'fed_peer', url: c.val('federation.library_peer.url'),
          fed_token: c.val('federation.library_peer.fed_token') || c.val('federation.fed_token'), verify_tls: verifyTls(c.val('federation.library_peer.verify_tls')),
        }} />
      </View>

      <Step n="③-B" title={tx('settings.federationSection.viewAnotherServersGuide')} note={tx('settings.federationSection.addServersViewThen')} />
      <ArrayCardEditor items={c.remoteNodes} onChange={(a) => c.set('federation.remote_nodes', a)}
        fields={[{ key: 'name', label: tx('library.musicSort.name') }, { key: 'url', label: 'URL', placeholder: 'https://host:port' }]}
        newItem={{ name: '', url: '', verify_tls: true }}
        renderExtra={(it) => <TestButton c={c} k={`fed-node-${it.url}`} body={{ type: 'fed_peer', url: it.url, fed_token: it.fed_token || c.val('federation.fed_token'), verify_tls: it.verify_tls !== false }} />} />

      <PartnerSteps c={c} />
      <FederationExtras c={c} />
    </CfgSection>
  );
}

const styles = StyleSheet.create({
  role: { marginVertical: 8, marginHorizontal: 13, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 },
  step: { paddingTop: 12, paddingHorizontal: 13, paddingBottom: 2, gap: 2 },
  lh: { lineHeight: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
