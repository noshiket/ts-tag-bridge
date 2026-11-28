import type { Video } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AudioCompareSection } from './audio-compare/AudioCompareSection';
import { useVideoFileActions } from './useVideoFileActions';
import { useVideoMaintenance } from './useVideoMaintenance';
import { VideoActionList } from './VideoActionList';
import { DeleteConfirm, PushConfirm } from './VideoConfirmPanels';
import { enqueuePush, usePushState } from '../../../lib/state/pushPeer';
import { ScrollSheet } from '../../../ui/sheets/ScrollSheet';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { TagJsonSheet } from '../TagJsonSheet';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 動画カードの「…」の詳細（元の VideoRow の詳細シート）。消す・移すなどの操作はここに集める（押し間違いを防ぐ）。
 * 並べ替え（設定順の時）・端末へ保存（Web）・ライブラリへ移動・解析値の再解析と確定値への反映・コメントの取り直し・
 * サムネイルの作り直し・重複録画の許可・連携先へ移動・ライブラリから削除。
 * tag.json の表示と修正、アドオン、字幕/実況の取り込み（このサーバーの動画だけ）。
 * ライブラリから消した時は、この端末に保存した分も消す（元と同じ）
 */
export function VideoDetailSheet({ video, node, title, open, onClose, onMove, canMoveUp, canMoveDown }: {
  video: Video & { album_id?: number | null; series_id?: number | null };
  node: string | null;
  title: string;
  open: boolean;
  onClose: () => void;
  onMove?: (dir: 'up' | 'down') => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme } = useTheme();
  const isMp4 = !!video.file_path && /\.(mp4|m4v)$/i.test(video.file_path);
  const [confirm, setConfirm] = useState<null | 'delete' | 'push'>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const push = usePushState(video.id);
  const opts = useQuery({ queryKey: ['encodeOptions', node ?? ''], queryFn: () => api.confirmed.encodeOptions(node), enabled: open });
  const peer = opts.data?.library_peer_name || null;
  // 一覧（アルバム・ビデオ表示・続きを見るなど）を読み直す
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['library'] }); void qc.invalidateQueries({ queryKey: ['watchHistory'] }); };
  const m = useVideoMaintenance(video, node, refresh);
  const f = useVideoFileActions(video, node, onClose, refresh);
  const close = () => { if (!f.deleting) { setConfirm(null); f.setDelErr(''); setCompareOpen(false); onClose(); } };

  return (
    <ScrollSheet open={open} onClose={close} after={<TagJsonSheet videoId={video.id} node={node} open={tagOpen} onClose={() => setTagOpen(false)} onApplied={refresh} />}>
      <T size={13} w={800} numberOfLines={1}>{title}</T>
      <T mono size={10} dim style={styles.mb14}>{tx('common.details')}</T>
      {/* ファイル名とフォルダ（カードには出さず、ここで見る） */}
      {video.file_path ? (
        <View style={[styles.pathBox, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <T range mono size={10}>{`🗎 ${video.file_path.split('/').pop()}`}</T>
          {video.file_path.includes('/') && <T range mono size={9} dim>{`📁 ${video.file_path.split('/').slice(0, -1).join('/')}`}</T>}
        </View>
      ) : null}

      {compareOpen && <AudioCompareSection video={video} onClose={() => setCompareOpen(false)} onApplied={refresh} />}
      {!confirm && !compareOpen && (
        <VideoActionList p={{
          videoId: video.id, node, music: video.media_kind === 'audio', isMp4, inLibrary: video.album_id != null || video.series_id != null,
          peer, canPush: !push || push.status === 'error', m, f, refresh, onMove, canMoveUp, canMoveDown,
          openCompare: () => setCompareOpen(true), openTag: () => setTagOpen(true),
          askPush: () => setConfirm('push'), askDelete: () => { setConfirm('delete'); f.setDelErr(''); } }} />
      )}
      {confirm === 'push' && (
        <PushConfirm peer={peer} lastError={push?.status === 'error' ? push.error ?? '' : null} onCancel={() => setConfirm(null)}
          onRun={() => { enqueuePush(video.id, node, api, refresh); setConfirm(null); onClose(); }} />
      )}
      {confirm === 'delete' && (
        <DeleteConfirm deleting={f.deleting} error={f.delErr} onCancel={() => { setConfirm(null); f.setDelErr(''); }} onRun={() => void f.remove()} />
      )}
      {confirm !== 'delete' && !compareOpen && (
        <Pressable onPress={close} style={[styles.close, { borderColor: theme.line }]}><T mono size={12} w={700} dim>{tx('common.close')}</T></Pressable>
      )}
    </ScrollSheet>
  );
}

const styles = StyleSheet.create({
  pathBox: { gap: 3, padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 14 },
  mb14: { marginBottom: 14 },
  close: { marginTop: 6, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' } });
