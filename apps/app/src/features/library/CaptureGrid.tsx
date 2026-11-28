import { shortDateTime, type Capture } from '@tstag/core';
import { useApi, useCaptureActions } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * アルバムのキャプチャ（2列）。元の Web 版のアルバムの「キャプチャ」タブ（再生画面のキャプチャタブでも使う）。
 * 絵を押すと撮った位置から再生（位置が無ければ原寸）。▶ ここから・🔍 原寸・動画サムネ・シリーズサムネ・削除。
 * 書き換える操作はこのサーバーのアルバムだけ（他のサーバーを見ている時は出さない）
 */
export function CaptureGrid({ captures, node, albumId, onPlayAt }: {
  captures: Capture[];
  node: string | null;
  albumId: number | null | undefined;
  /** 撮った位置から再生する */
  onPlayAt: (c: Capture) => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const actions = useCaptureActions(albumId);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [viewing, setViewing] = useState<Capture | null>(null);
  const editable = node == null;
  const source = (c: Capture) => ({ uri: api.library.captureUrl(c.path, node), headers: api.client.authHeaders() });

  // 原寸: Web は新しいタブ（元と同じ）。iOS は画面に重ねる（画像の読み込みにログインの印が要る）
  const openFull = (c: Capture) => {
    if (Platform.OS === 'web') window.open(api.library.captureUrl(c.path, node), '_blank');
    else setViewing(c);
  };
  const setThumb = (kind: 'video' | 'series', c: Capture) => {
    setMsg(null);
    (kind === 'video' ? actions.videoThumb : actions.seriesThumb).mutate(c, {
      onSuccess: (r) => setMsg(r.ok
        ? { ok: true, text: kind === 'video' ? tx('library.captureGrid.setVideoThumbnail') : tx('library.captureGrid.setSeriesThumbnail') }
        : { ok: false, text: r.error || tx('library.captureGrid.couldntSet') }),
      onError: () => setMsg({ ok: false, text: tx('library.captureGrid.requestFailed') }),
    });
  };

  if (!captures.length) return <T size={12} dim style={styles.empty}>{tx('library.captureGrid.noCapturesAlbum')}</T>;
  return (
    <View>
      {msg && (
        <View style={[styles.msg, { backgroundColor: msg.ok ? '#DCF3E1' : '#FBDCD6' }]}>
          <T mono size={11} color={msg.ok ? '#1D6B36' : '#9E1F22'}>{msg.text}</T>
        </View>
      )}
      <View style={styles.grid}>
        {captures.map((c) => (
          <View key={c.id} style={[styles.cell, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
            <Pressable onPress={() => (c.tot ? onPlayAt(c) : openFull(c))}
              accessibilityLabel={c.tot ? tx('library.capture.playHere') : tx('library.captureGrid.openFullSize')}>
              <Image source={source(c)} style={styles.img} contentFit="cover" cachePolicy="memory-disk" />
            </Pressable>
            <View style={styles.body}>
              <T size={10} w={700} numberOfLines={1}>{c.series_name || c.eit_title || ''}</T>
              <T mono size={8} dim style={styles.meta}>
                {[c.episode_number ? `#${c.episode_number}` : '', shortDateTime(c.created_at)].filter(Boolean).join(' · ')}
              </T>
              <View style={styles.actions}>
                {c.tot && <Act grow color={accent.primary} bold onPress={() => onPlayAt(c)}>{tx('library.captureGrid.here')}</Act>}
                <Act onPress={() => openFull(c)}>🔍</Act>
                {editable && c.video_id != null && <Act grow onPress={() => setThumb('video', c)}>{tx('library.captureGrid.videoThumb')}</Act>}
                {editable && c.series_id != null && <Act grow onPress={() => setThumb('series', c)}>{tx('library.captureGrid.seriesThumb')}</Act>}
              </View>
              {editable && <Act full onPress={() => { setMsg(null); actions.remove.mutate(c); }}>{tx('reservations.list.sheet.delete')}</Act>}
            </View>
          </View>
        ))}
      </View>
      <Modal visible={viewing != null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)} accessibilityLabel={tx('common.close')}>
          {viewing && <Image source={source(viewing)} style={styles.full} contentFit="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

function Act({ children, onPress, grow, full, bold, color }: {
  children: ReactNode; onPress: () => void; grow?: boolean; full?: boolean; bold?: boolean; color?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress}
      style={[styles.act, grow && styles.grow, full && styles.fullBtn, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      <T mono size={9} w={bold ? 800 : 400} color={color ?? theme.mute} numberOfLines={1}>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '48%', flexGrow: 1, borderWidth: 1.5, borderRadius: 12, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  body: { paddingVertical: 6, paddingHorizontal: 8 },
  meta: { marginTop: 1 },
  // 狭い所（再生画面の右パネル）では折り返す
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  act: { paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, alignItems: 'center' },
  grow: { flexGrow: 1 },
  fullBtn: { marginTop: 4 },
  msg: { marginBottom: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 },
  empty: { textAlign: 'center', padding: 40 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
