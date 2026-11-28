import type { MsgKey } from '@tstag/core';
import { nodePath, type StreamMeta } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { downloadAndShare } from '../../../lib/device/downloadShare';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

// 先に出す主要な項目。残りは拾えたものを名前順で全部並べる（元の live_right_panel.jsx と同じ）
const HEAD: [string, MsgKey][] = [['title', 'player.musicInfo.title'], ['artist', 'library.music.tab.artists'], ['album_artist', 'player.musicInfo.albumArtist'],
  ['album', 'library.tab.albums'], ['track', 'player.musicInfo.track'], ['disc', 'player.musicInfo.disc'], ['tpa', 'player.musicInfo.disc'],
  ['date', 'library.musicSort.year'], ['genre', 'common.genre'], ['composer', 'player.musicInfo.composer'], ['performer', 'player.musicInfo.performer'],
  ['publisher', 'player.musicInfo.label'], ['copyright', 'player.musicInfo.copyright'], ['comment', 'common.comments2']];

/**
 * 「曲情報」タブ（元の ProgramInfoTab の音楽の分）。番組情報ではなく、原本から取り込んだ情報を出す。
 * 歌詞のような長い値は折り返して全文出す
 */
export function MusicInfo({ meta, videoId, node, onEdit }: { meta: StreamMeta; videoId: number; node: string | null; onEdit: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const tags = meta.media_tags ?? {};
  const spec = meta.source_audio ?? {};
  const lyricKeys = Object.keys(tags).filter((k) => k === 'lyrics' || k.startsWith('lyrics-') || k === 'unsyncedlyrics' || k === 'uslt');
  const shown = new Set([...HEAD.map((h) => h[0]), ...lyricKeys]);
  const rest = Object.keys(tags).filter((k) => !shown.has(k)).sort();
  const specStr = [spec.codec?.toUpperCase(), spec.sample_rate && `${spec.sample_rate / 1000}kHz`, spec.bits_per_sample && `${spec.bits_per_sample}bit`,
    spec.channels && `${spec.channels}ch`, spec.bit_rate && `${Math.round(spec.bit_rate / 1000)}kbps`].filter(Boolean).join(' / ');
  const row = (label: string, value: string, key: string) => (
    <View key={key} style={[styles.row, { borderTopColor: theme.line }]}>
      <T mono size={10} dim style={styles.label}>{label}</T>
      <T size={11} style={styles.value}>{value}</T>
    </View>
  );
  // 再生用の音声は AAC で非可逆。可逆で欲しい時はこちらを配る（FLAC → AIFF はビット単位で同じ）。
  // 取り出したファイルの置き場が要るので Web だけ（ブラウザが保存する）
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const download = async (mode: string) => {
    const url = api.client.url(nodePath(node, `/api/videos/${videoId}/download?source=${mode || '1'}&attach=1`));
    if (Platform.OS === 'web') { void Linking.openURL(url); return; }
    // iOS: 端末へ落としてから共有シートで渡す（「ファイルに保存」など）
    if (saving) return;
    setDlMsg(null); setSaving(true);
    const ext = mode === 'aiff' ? '.aiff' : meta.archive_ext || '';
    const err = await downloadAndShare(url, api.client.authHeaders(), `${meta.title || `audio-${videoId}`}${ext}`);
    setSaving(false);
    setDlMsg(err);
  };
  const lossless = `⤓ 可逆音源${meta.archive_ext ? `（${meta.archive_ext.replace('.', '').toUpperCase()}${meta.archive_size ? ` / ${Math.round(meta.archive_size / 1024 / 1024)}MB` : ''}）` : ''}`;
  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <T size={16} w={800}>{meta.title || tx('player.musicInfo.untitled')}</T>
          <T mono size={11} dim>{[meta.artist, meta.series_name].filter(Boolean).join(' / ')}</T>
        </View>
        <Pressable onPress={onEdit} accessibilityLabel={tx('player.musicInfo.fixTitleArtistAlbum')} style={[styles.edit, { backgroundColor: accent.primary }]}>
          <T mono size={10} w={700} color="#fff">{tx('common.edit2')}</T>
        </Pressable>
      </View>
      {specStr ? <T mono size={10} dim>{tx('player.musicInfo.original', { v0: specStr })}</T> : null}
      {meta.has_lossless ? (
        <View style={styles.dlRow}>
          {([['', lossless], ['aiff', tx('player.musicInfo.asAiff')]] as const).map(([mode, label]) => (
            <Pressable key={mode || 'as-is'} onPress={() => void download(mode)} style={[styles.dl, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <T mono size={10}>{label}</T>
            </Pressable>
          ))}
          {saving && <T mono size={10} dim>{tx('common.downloading')}</T>}
          {dlMsg && <T mono size={10} color="#ef4444">{dlMsg}</T>}
        </View>
      ) : <T mono size={10} color="#ef4444">{tx('player.musicInfo.noLosslessSourceTrack')}</T>}
      {lyricKeys.map((k) => (
        <View key={k} style={styles.lyrics}>
          <T mono size={10} dim>{tx('player.musicInfo.lyrics')}</T>
          <T size={12} style={styles.lyricText}>{tags[k]}</T>
        </View>
      ))}
      <View style={styles.table}>
        {HEAD.filter(([k]) => tags[k]).map(([k, label]) => row(tx(label), tags[k]!, k))}
        {rest.map((k) => row(k, tags[k]!, k))}
      </View>
      {!Object.keys(tags).length && (
        <T mono size={11} dim>{tx('player.musicInfo.trackHasNoEmbedded', { v0: meta.has_source ? '' : tx('player.musicInfo.cantRereadOriginalGone') })}</T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 14, gap: 6 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  edit: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8 },
  dlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dl: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  lyrics: { marginTop: 8, gap: 4 },
  lyricText: { lineHeight: 20 },
  table: { marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 3, borderTopWidth: 1 },
  label: { width: 120 },
  // 区切りの無い長い値（CDDB の番号など）も途中で折り返す（元は word-break: break-all）
  value: { flex: 1, ...(Platform.OS === 'web' ? { wordBreak: 'break-all' } as object : {}) },
});
