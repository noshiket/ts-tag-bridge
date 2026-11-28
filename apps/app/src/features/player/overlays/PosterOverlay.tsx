import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

/** どの動画・録画のサムネか（端末に保存した物ならその画像） */
export interface PosterTarget { rec: boolean; videoId: number; node: string | null; local?: string | null }

/**
 * 再生が始まるまで、映像の所にサムネを出す（元の Web 版の <video poster> と同じ）。
 * 出さないと、読み込んでいる間（バッファリング中）は真っ黒のままになる。一度映像が動き出したら、
 * その後に止めても・読み込み直しても出さない（止めた所のコマが見えている方がよい）
 */
export function PosterOverlay({ target, started }: { target: PosterTarget; started: boolean }) {
  const api = useApi();
  const shown = useRef(true);
  // 次の話へ進んだ時など、見るものが変わったらまた出す
  const key = `${target.rec}:${target.videoId}:${target.node ?? ''}`;
  const lastKey = useRef(key);
  if (lastKey.current !== key) { lastKey.current = key; shown.current = true; }
  if (started) shown.current = false;
  if (!shown.current) return null;
  const uri = target.local
    ?? (target.rec ? api.recordings.thumbnailUrl(target.videoId, target.node) : api.library.videoThumbnailUrl(target.videoId, target.node));
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Image source={{ uri, headers: target.local ? undefined : api.client.authHeaders() }} style={StyleSheet.absoluteFill} contentFit="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
});
