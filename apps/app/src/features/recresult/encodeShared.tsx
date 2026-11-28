import type { EncodeRow } from '@tstag/core';
import { useApi, useEncodePause } from '@tstag/core/react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

// エンコードのタブの標準とアンドンの表示で共有する部品

/** エンコード全体の停止・再開（見ているサーバーに効く）。停止しても実行中の1本は最後までやる */
export function PauseControl({ node }: { node: string | null }) {
  const { accent } = useTheme();
  const { t: tx } = useT();
  const { paused, set } = useEncodePause(node);
  if (paused == null) return null;
  return (
    <View style={styles.pause}>
      <Pressable onPress={() => set.mutate(!paused)} disabled={set.isPending}
        accessibilityLabel={tx(paused ? 'recresult.encode.resumeA11y' : 'recresult.encode.pauseA11y')}
        style={[styles.pauseBtn, { backgroundColor: paused ? accent.primary : 'rgba(255,255,255,0.18)', opacity: set.isPending ? 0.6 : 1 }]}>
        <T mono size={11} w={800} color="#fff">{tx(paused ? 'recresult.encode.resume' : 'recresult.encode.pause')}</T>
      </Pressable>
      {paused && <T mono size={8} color="#ffd479">{tx('recresult.encode.pausedNote')}</T>}
    </View>
  );
}

export function useThumb(e: EncodeRow, node: string | null) {
  const api = useApi();
  const uri = api.encodes.thumbnailUrl(e, node);
  return uri ? { uri, headers: api.client.authHeaders() } : null;
}

/** 押すとエンコード進捗の画面へ（元と同じ） */
export const openEncoding = (e: EncodeRow) => router.push({ pathname: '/encoding/[id]', params: { id: e.id } });

const styles = StyleSheet.create({
  pause: { alignItems: 'flex-end', gap: 3 },
  pauseBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
});
