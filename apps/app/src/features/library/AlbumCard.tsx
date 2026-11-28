import { dateWithYear, type AlbumSummary } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Pressable, StyleSheet, View } from 'react-native';

import { More } from '../../ui/parts/Icons';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { danger } from '../../ui/theme/theme';
import { shadow } from '../../ui/theme/edge';
import { NEW_RED } from './views/albumParts';
import { useT } from '../../ui/i18n/I18n';

/** アルバム一覧の1件（元の encode.jsx の AlbumCard）。録画・ビデオのカードに合わせ、大きいサムネと高さの揃ったカード */
export function AlbumCard({ album, node, onPress, inMylist, onToggleMylist, onMenu }: {
  album: AlbumSummary;
  node: string | null;
  onPress: () => void;
  inMylist?: boolean;
  /** 他のサーバーを見ている時は出さない（マイリストはこのサーバーの利用者に付く） */
  onToggleMylist?: (on: boolean) => void;
  onMenu?: () => void;
}) {
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  // 分類エラー: 動画の置かれているフォルダ名がアルバム名と食い違っている
  const bad = (album.folder_mismatch ?? []).length > 0;
  const edge = bad ? danger : theme.cardFrame;
  const uri = `${api.library.albumThumbnailUrl(album.id, node)}?v=${encodeURIComponent(album.latest_video_updated_at ?? '')}`;
  return (
    <Pressable onPress={onPress} style={[styles.card, { backgroundColor: theme.surface, borderColor: edge, boxShadow: shadow(theme, 3, edge) }]}>
      <ReelThumb source={{ uri, headers: api.client.authHeaders() }} hue={hueFromId(album.id)} width={160} height={90} />
      {/* 録画・ビデオのカードと同じ作り: 名前は大きく2行分の高さ、ほかは小さく1行。どのカードも同じ高さ */}
      <View style={styles.body}>
        <T size={15} w={800} numberOfLines={2} style={styles.title}>{album.name}</T>
        <View style={styles.countRow}>
          {album.has_new_episode && <View style={styles.newTag}><T size={9} w={900} color="#fff">{tx('library.album.new')}</T></View>}
          <T size={11} dim numberOfLines={1} style={styles.grow}>
            {`${tx('library.album.count', { n: album.video_count })}${album.latest_video_at ? ` · ${tx('library.album.last', { date: dateWithYear(album.latest_video_at) })}` : ''}`}
          </T>
        </View>
        <View style={styles.bottom}>
          <View style={styles.grow}>
            {bad && (
              <T mono size={9} w={800} color={danger} numberOfLines={2}>
                {tx('library.album.mismatch', { n: album.folder_mismatch_count || 0, total: album.video_count, folders: album.folder_mismatch.join(' / ') })}
              </T>
            )}
          </View>
          {onToggleMylist && (
            <Pressable hitSlop={6} onPress={() => onToggleMylist(!inMylist)} accessibilityLabel={tx(inMylist ? 'library.album.mylistRemove' : 'library.album.mylistAdd')} style={styles.star}>
              <T size={18} color={inMylist ? accent.primary : theme.mute}>{inMylist ? '★' : '☆'}</T>
            </Pressable>
          )}
          {onMenu && (
            <Pressable onPress={onMenu} accessibilityLabel={tx('common.menu')} style={[styles.menu, { backgroundColor: theme.surface, borderColor: theme.line }]}>
              <More s={14} c={theme.ink} />
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 14, padding: 10, flexDirection: 'row', gap: 10, height: 112 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { lineHeight: 19, height: 38 },
  bottom: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  newTag: { backgroundColor: NEW_RED, paddingHorizontal: 5, paddingVertical: 1 },
  star: { paddingVertical: 4, paddingHorizontal: 6 },
  menu: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
