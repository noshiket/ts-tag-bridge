import type { Video } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { downloadAndShare } from '../../../lib/device/downloadShare';
import { localSave } from '../../../lib/localSave/store';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 動画そのものの操作: 端末へダウンロード（Web は新しいタブ、iOS は落としてから共有シート）・
 * 重複録画の許可・ライブラリから削除（この端末に保存した分と続きを見るからも消す）・ライブラリへ移動
 */
export function useVideoFileActions(video: Video & { album_id?: number | null; series_id?: number | null }, node: string | null, onClose: () => void, refresh: () => void) {
  const { t: tx } = useT();
  const api = useApi();
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [allowDup, setAllowDup] = useState(!!video.allow_duplicate);
  const [delErr, setDelErr] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setAllowDup(!!video.allow_duplicate); }, [video.allow_duplicate]);

  const downloadVideo = async () => {
    const url = api.videoActions.downloadUrl(video.id, node);
    if (Platform.OS === 'web') { window.open(url, '_blank'); return; }
    if (dlBusy) return;
    setDlErr(null); setDlBusy(true);
    const name = video.file_path?.split('/').pop() || `video-${video.id}.mp4`;
    setDlErr(await downloadAndShare(url, api.client.authHeaders(), name));
    setDlBusy(false);
  };
  const toggleDup = () => {
    const next = !allowDup;
    setAllowDup(next);
    api.videoActions.allowDuplicate(video.id, next, node).catch(() => setAllowDup(!next));
  };
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDelErr('');
    try {
      await api.videoActions.remove(video.id, node);
      void localSave.remove(video.id, node).catch(() => {});
      // 続きを見るに残ると、サムネなどが取れずに残り続けるので消す
      await api.watch.remove(`video:${video.id}`).catch(() => {});
      onClose();
      refresh();
    } catch (e) { setDelErr(e instanceof Error ? e.message : tx('common.deleteFailed')); setDeleting(false); }
  };
  const goLibrary = async () => {
    onClose();
    let albumId = video.album_id ?? null;
    if (albumId == null && video.series_id != null) {
      try { albumId = (await api.library.series(video.series_id, node)).album_id ?? null; } catch { /* 無い */ }
    }
    if (albumId != null) router.push({ pathname: '/album/[id]', params: { id: String(albumId), ...(video.series_id != null ? { series: String(video.series_id) } : {}) } });
  };

  return { dlBusy, dlErr, downloadVideo, allowDup, toggleDup, deleting, delErr, setDelErr, remove, goLibrary };
}
