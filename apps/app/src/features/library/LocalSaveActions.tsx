import { localSaveMetaOf, localSaveMime, type Video } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useWaitingForWifi } from '../../lib/localSave/cellular';
import { localSave, localStateOf, queuedLabel, shallowEq, useLocalSaveSelect } from '../../lib/localSave/store';
import { File } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { danger } from '../../ui/theme/theme';
import { useT } from '../../ui/i18n/I18n';

/** そのカードの動画を保存できるか（TS など保存できない形式と、保存先の無い端末では出さない） */
export const canLocalSave = (v: Video) => localSave.available() && !!localSaveMime(v.file_path);

/**
 * ビデオカードのローカル保存の操作（元の VideoRow のボタン列）: 保存（副音声で保存）・待機中/進み具合と取り消し・
 * 失敗・補助データ更新・キャッシュ削除。保存済みなら「▶ 再生」は端末の保存から（呼び出し側）
 */
export function LocalSaveActions({ video, node, series }: { video: Video; node: string | null; series: string }) {
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  // この動画の保存の状態だけを読む（ほかの動画の進み具合では描き直さない）
  const { saved, active } = useLocalSaveSelect((s) => localStateOf(s, video.id, node), shallowEq);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const waitWifi = useWaitingForWifi();
  if (!canLocalSave(video)) return null;
  const btn = (label: string, onPress: () => void, color = theme.ink, title?: string) => (
    <Pressable onPress={onPress} accessibilityLabel={title ?? label} style={[styles.btn, { backgroundColor: theme.surface }]}>
      <T mono size={10} w={700} color={color}>{label}</T>
    </Pressable>
  );
  const cancel = () => void localSave.cancel(video.id, node);
  if (active?.status === 'queued') return <><T mono size={9} dim style={styles.grow}>{queuedLabel(active.progress)}</T>{btn(tx('library.local.cancel'), cancel, theme.mute)}</>;
  if (active?.status === 'downloading') {
    const pct = Math.round(active.progress * 100);
    return (
      <View style={styles.progRow}>
        <View style={[styles.track, { backgroundColor: theme.line }]}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: accent.primary }} /></View>
        <T mono size={9} dim>{waitWifi ? tx('library.local.waitWifi', { pct }) : `${pct}%`}</T>
        {btn(tx('library.local.cancel'), cancel, theme.mute)}
      </View>
    );
  }
  const meta = localSaveMetaOf(video, series);
  if (saved) {
    const refresh = async () => {
      setBusy(true); setMsg('');
      try { await localSave.refreshSidecar(api, video.id, node); } catch (e) { setMsg(e instanceof Error ? e.message : tx('library.local.refreshFailed')); }
      finally { setBusy(false); }
    };
    return (
      <>
        {!!msg && <T mono size={9} color={danger} style={styles.grow}>{msg}</T>}
        {/* 文字は短く（カードの下の段に再生・… と並べるため）。保存した日時はカードの下の段の左に出す */}
        {btn(tx(busy ? 'library.local.refreshing' : 'library.local.refresh'), () => { if (!busy) void refresh(); }, theme.mute, tx('library.local.refreshA11y'))}
        {btn(tx(saved.audio === 'secondary' ? 'library.local.removeSap' : 'library.local.remove'), () => void localSave.remove(video.id, node), theme.mute, tx('library.local.removeA11y'))}
      </>
    );
  }
  return (
    <>
      {active?.status === 'error' && <T mono size={9} color={danger} numberOfLines={1} style={styles.grow}>{tx('library.local.dlFailed', { error: active.error ?? '' })}</T>}
      <Pressable onPress={() => localSave.download(api, video.id, node, meta)} style={[styles.btn, styles.row, { backgroundColor: theme.surface }]}>
        <File s={12} c={theme.ink} /><T mono size={10} w={700}>{tx('library.local.save')}</T>
      </Pressable>
      {/* 副音声版をサーバーで作って保存する（保存の枠は同じなので主音声版とはどちらか一方）。
          新しいアプリは保存した分の音声を切り替えられないので、副音声のある動画にはいつも出す */}
      {video.has_secondary_audio === 1 && (
        <Pressable onPress={() => localSave.download(api, video.id, node, meta, true)} accessibilityLabel={tx('library.local.saveSapA11y')}
          style={[styles.btn, styles.row, { backgroundColor: theme.surface }]}>
          <File s={12} c={theme.mute} /><T mono size={10} w={700} dim>{tx('library.local.saveSap')}</T>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grow: { flex: 1 },
  progRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
});
