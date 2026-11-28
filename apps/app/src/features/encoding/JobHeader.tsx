import type { EncodeRow } from '@tstag/core';
import { useApi, useLogoSet } from '@tstag/core/react';
import { Linking, StyleSheet, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { StationLogo } from '../../ui/parts/StationLogo';
import { StatusPill } from '../../ui/parts/StatusPill';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';

/** 仕事の見出しのカード（番号・工程・題名・話数・局・プリセット・状態）と、失敗の理由（中の URL は押せる） */
export function JobHeader({ e, node }: { e: EncodeRow; node: string | null }) {
  const { theme, accent } = useTheme();
  const api = useApi();
  const logos = useLogoSet().data;
  const thumbUri = api.encodes.thumbnailUrl(e, node);
  return (
    <>
      <View style={[styles.job, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 4) }]}>
        <ReelThumb source={thumbUri ? { uri: thumbUri, headers: api.client.authHeaders() } : null} hue={e.isAddon ? 280 : hueFromId(e.id)} size={54} />
        <View style={styles.grow}>
          <View style={styles.row5}>
            <View style={[styles.tag, { backgroundColor: theme.ink }]}><T mono size={9} w={700} color={theme.onInk}>{String(e.id)}</T></View>
            <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={9} dim>{e.state}</T></View>
          </View>
          <View style={[styles.row6, styles.mt4]}>
            <T size={13} w={700} numberOfLines={1} style={styles.shrink}>{e.title}</T>
            {!!e.episodeNumber && <View style={[styles.ep, { backgroundColor: accent.tertiary }]}><T mono size={11} w={700} color="#fff">{`#${e.episodeNumber}`}</T></View>}
          </View>
          <View style={[styles.row5, styles.mt2]}>
            {e.onid != null && e.sid != null && logos?.has(`${e.onid}-${e.sid}`) && <StationLogo onid={e.onid} sid={e.sid} height={12} maxWidth={22} />}
            <T mono size={10} dim>{`${e.sid ? `SID:${e.sid}` : ''} · ${e.preset}`}</T>
          </View>
        </View>
        {/* 元の PAUSE は押しても何も起きない飾りなので出さない */}
        {e.status !== 'running' && <StatusPill status={e.status} />}
      </View>
      {!!e.errorMessage && (
        <View style={styles.err}>
          <T mono size={10} color={oklch(0.75, 0.18, 25)}>⚠ <Linkify text={e.errorMessage} /></T>
        </View>
      )}
    </>
  );
}

/** 文の中の URL（ロゴ解析へのリンクなど）を押せるようにする */
function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((p, i) => (/^https?:\/\//.test(p)
        ? <T key={i} mono size={10} color={oklch(0.82, 0.16, 230)} style={styles.underline} onPress={() => void Linking.openURL(p)}>{p}</T>
        : p))}
    </>
  );
}

const styles = StyleSheet.create({
  job: { borderWidth: 1.5, borderRadius: 18, padding: 12, flexDirection: 'row', gap: 11, alignItems: 'center', marginBottom: 14 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  row5: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  ep: { paddingHorizontal: 5, borderRadius: 3, flexShrink: 0 },
  mt2: { marginTop: 2 },
  mt4: { marginTop: 4 },
  err: {
    marginBottom: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: oklch(0.18, 0.05, 25),
    borderWidth: 1.5, borderColor: oklch(0.55, 0.22, 25), borderRadius: 10,
  },
  underline: { textDecorationLine: 'underline' },
});
