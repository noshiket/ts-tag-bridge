import { tNow } from '../../ui/i18n/I18n';
import { useApi, useExactFrames } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';

/**
 * 分割タブで止めている間、映像の上に編集点のコマ（厳密）を出す（元の SplitFrameOverlay）。
 * コマ送りを続けている間は途中のコマを作らせない（止めて 300ms 後の位置だけ読む）。読み終わるまでは前のコマを出しておく
 */
export function SplitFrameOverlay({ dbRecId, t, node }: { dbRecId: number; t: number; node: string | null }) {
  const api = useApi();
  const url = api.recordings.frameUrl(dbRecId, Number((t || 0).toFixed(3)), node);
  const [pending, setPending] = useState(url);
  const [shown, setShown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => setPending(url), 300);
    return () => clearTimeout(id);
  }, [url]);
  const times = useMemo(() => [Math.round((t || 0) * 1000) / 1000], [t]);
  const { status } = useExactFrames(dbRecId, node, times);
  const headers = api.client.authHeaders();
  const shownSrc = useMemo(() => (shown ? { uri: shown, headers } : null), [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingSrc = useMemo(() => ({ uri: pending, headers }), [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {shownSrc && <Image source={shownSrc} contentFit="contain" style={StyleSheet.absoluteFill} />}
      {/* 読み終えてから差し替える（黒い画面やちらつきを出さない） */}
      {pending !== shown && (
        <Image key={pending} source={pendingSrc} style={styles.hidden}
          onLoad={() => { setShown(pending); setLoading(false); }} onError={() => setLoading(false)} />
      )}
      {loading && <View style={styles.center}><ActivityIndicator size="large" color="#10b981" /></View>}
      {status && (
        <View style={styles.badge}>
          <T mono size={9} w={800} color={status === 'ready' ? '#7CFC9E' : status === 'building' ? '#FFD60A' : '#bbb'}>
            {tNow(status === 'ready' ? 'split.frame.exact' : status === 'building' ? 'split.frame.building' : 'split.frame.approx')}
          </T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, right: 8, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
});
