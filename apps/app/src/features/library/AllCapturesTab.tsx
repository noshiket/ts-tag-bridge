import { groupCapturesByAlbum, type LibraryCapture } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { downloadAndCopyImage, downloadAndShare } from '../../lib/device/downloadShare';
import { useViewNode } from '../../lib/state/viewNode';
import { Chev } from '../../ui/parts/Icons';
import { Num } from '../../ui/parts/Num';
import { ResultMessage } from '../../ui/parts/ResultMessage';
import { CaptureSheet } from './captures/CaptureSheet';
import { CaptureStill } from './captures/CaptureStill';
import { gridCells } from './views/albumParts';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * ライブラリの「キャプチャ」（元の LibraryScreen のキャプチャタブ）: 全部のキャプチャをアルバムごとにまとめ、絵を大きく敷き詰める。
 * 絵を押すと撮った位置から再生（位置が無ければ原寸）。… か長押しで操作（ここから再生・原寸・端末へ保存・コピー・削除）。
 * iOS の ⤓ は落としてから共有シートで渡し（「写真に保存」など）、コピーは iOS のクリップボードへ入れる
 */
export function AllCapturesTab() {
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const { viewNode } = useViewNode();
  const key = ['library', viewNode ?? '', 'allCaptures'];
  const q = useQuery({ queryKey: key, queryFn: () => api.library.allCaptures(viewNode) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [menu, setMenu] = useState<LibraryCapture | null>(null);
  const [w, setW] = useState(0);
  const web = Platform.OS === 'web';
  const url = (f: string) => api.library.captureUrl(f, viewNode);
  const source = (f: string) => ({ uri: url(f), headers: api.client.authHeaders() });
  const openFull = (f: string) => (web ? window.open(url(f), '_blank') : setViewing(f));
  const playAt = (c: LibraryCapture) => router.push({ pathname: '/watch/[id]', params: { id: String(c.video_id), tot: c.tot! } });
  const remove = async (f: string) => {
    try { await api.library.deleteCapture(f, viewNode); qc.setQueryData<LibraryCapture[]>(key, (l) => l?.filter((x) => x.file !== f)); } catch { /* 元と同じく黙る */ }
  };
  // 端末へ保存（Web はダウンロード、iOS は共有シート）
  const save = async (f: string) => {
    const dl = api.library.captureDownloadUrl(f, viewNode);
    if (web) { window.open(dl, '_blank'); return; }
    setMsg(null);
    const err = await downloadAndShare(dl, api.client.authHeaders(), f.split('/').pop() || 'capture.jpg');
    if (err) setMsg({ ok: false, text: err });
  };
  // 画像をクリップボードへ（元の copyAllCapturesItem の最初の方法。iOS は落としてから iOS のクリップボードへ）
  const copy = async (f: string) => {
    setMsg(null);
    if (!web) {
      const err = await downloadAndCopyImage(url(f), api.client.authHeaders(), f.split('/').pop() || 'capture.jpg');
      setMsg(err ? { ok: false, text: err } : { ok: true, text: tx('library.capture.copied') });
      return;
    }
    try {
      const blob = await (await fetch(url(f), { headers: api.client.authHeaders() })).blob();
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d')!.drawImage(bmp, 0, 0);
      const png = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error())), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setMsg({ ok: true, text: tx('library.capture.copied') });
    } catch {
      setMsg({ ok: false, text: tx('library.capture.copyFailed') });
    }
  };

  if (!q.data) return <T size={12} dim style={styles.empty}>{q.error ? q.error.message : tx('common.loading')}</T>;
  if (!q.data.length) return <T size={12} dim style={styles.empty}>{tx('library.capture.empty')}</T>;
  const { cellW } = gridCells(w, GAP, 210, 2);
  return (
    <View style={styles.pad} onLayout={(e) => setW(e.nativeEvent.layout.width - 36)}>
      <ResultMessage msg={msg} style={styles.msg} />
      {groupCapturesByAlbum(q.data).map((g) => (
        <View key={g.key} style={styles.group}>
          <Pressable disabled={g.albumId == null} onPress={() => router.push({ pathname: '/album/[id]', params: { id: String(g.albumId) } })}
            style={[styles.head, { borderBottomColor: theme.line }]}>
            <T size={13} w={800} numberOfLines={1} style={styles.name}>{g.name}</T>
            <Num size={14} color={accent.primary}>{String(g.items.length)}</Num>
            <T size={9} w={700} dim>{tx('library.capture.unit', { n: g.items.length })}</T>
            {g.albumId != null && <Chev s={10} c={theme.mute} />}
          </Pressable>
          <View style={styles.grid}>
            {cellW > 0 && g.items.map((c) => (
              <CaptureStill key={c.file} c={c} source={source(c.file)} width={cellW} onMenu={() => setMenu(c)}
                onPress={() => (c.tot && c.video_id != null ? playAt(c) : openFull(c.file))} />
            ))}
          </View>
        </View>
      ))}
      <CaptureSheet c={menu} onClose={() => setMenu(null)} onPlay={playAt} onFull={(c) => openFull(c.file)}
        onSave={(c) => void save(c.file)} onCopy={(c) => void copy(c.file)} onDelete={(c) => void remove(c.file)} />
      <Modal visible={viewing != null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)} accessibilityLabel={tx('common.close')}>
          {viewing && <Image source={source(viewing)} style={styles.full} contentFit="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const GAP = 6;

const styles = StyleSheet.create({
  empty: { textAlign: 'center', padding: 40 },
  pad: { paddingHorizontal: 18 },
  msg: { marginBottom: 10 },
  group: { marginBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingBottom: 5, marginBottom: 8, borderBottomWidth: 1 },
  name: { flexShrink: 1, marginRight: 4 },
  // iOS は折り返しの行で 16:9 の高さが伸ばしに負けるので、行の高さに合わせない
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GAP },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
