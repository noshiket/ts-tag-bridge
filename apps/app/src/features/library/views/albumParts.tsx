import type { AlbumSummary } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { useT } from '../../../ui/i18n/I18n';

export const NEW_RED = '#E8432E';

/** アルバムのサムネ（16:9 で枠いっぱい。読めなければ作品ごとの色） */
export function AlbumImage({ album, node }: { album: AlbumSummary; node: string | null }) {
  const api = useApi();
  const [err, setErr] = useState(false);
  const uri = `${api.library.albumThumbnailUrl(album.id, node)}?v=${encodeURIComponent(album.latest_video_updated_at ?? '')}`;
  return err
    ? <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.5, 0.12, hueFromId(album.id)) }]} />
    : <Image source={{ uri, headers: api.client.authHeaders() }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" onError={() => setErr(true)} />;
}

/** 左上の印: 新着（赤）とマイリストの ★ */
export function AlbumMarks({ album, inMylist }: { album: AlbumSummary; inMylist: boolean }) {
  const { t: tx } = useT();
  if (!album.has_new_episode && !inMylist) return null;
  return (
    <View style={styles.marks}>
      {album.has_new_episode && <View style={styles.newTag}><T size={9} w={900} color="#fff" style={GOTHIC}>{tx('library.album.new')}</T></View>}
      {inMylist && <T size={13} color="#F2C14E" style={styles.star}>★</T>}
    </View>
  );
}

/** 幅から列の数とコマの幅を決める（最後の行も同じ大きさにそろえる） */
export function gridCells(width: number, gap: number, target: number, min: number) {
  const cols = Math.max(min, Math.floor((width + gap) / (target + gap)));
  return { cols, cellW: width > 0 ? (width - gap * (cols - 1)) / cols : 0 };
}

const styles = StyleSheet.create({
  marks: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  newTag: { backgroundColor: NEW_RED, paddingHorizontal: 5, paddingVertical: 1 },
  star: { textShadowColor: '#000', textShadowRadius: 3, paddingHorizontal: 2 },
});
