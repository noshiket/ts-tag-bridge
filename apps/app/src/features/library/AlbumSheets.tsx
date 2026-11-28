import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { ScrollSheet } from '../../ui/sheets/ScrollSheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);
type Failed = { id: number; error: string }[] | undefined;

function Buttons({ busy, ok, cancel, go, onCancel, onGo, danger }: { busy: boolean; ok: boolean; cancel: string; go: string; onCancel: () => void; onGo: () => void; danger?: boolean }) {
  const { theme, accent } = useTheme();
  return (
    <View style={styles.btns}>
      <Pressable onPress={onCancel} disabled={busy} style={[styles.cancel, { borderColor: theme.line }]}><T mono size={12} w={700} dim>{cancel}</T></Pressable>
      <Pressable onPress={onGo} disabled={!ok} style={[styles.go, { backgroundColor: ok ? (danger ? RED : accent.primary) : theme.line }]}>
        <T mono size={12} w={800} color="#fff">{go}</T>
      </Pressable>
    </View>
  );
}

function FailedList({ failed }: { failed: Failed }) {
  if (!failed?.length) return null;
  return (
    <View style={[styles.failed, { borderColor: RED }]}>
      {failed.map((f) => <T key={f.id} mono size={9} dim>{`id=${f.id}: ${f.error}`}</T>)}
    </View>
  );
}

/**
 * フォルダ名・シリーズ名を変える（元の RenameFolderSheet / RenameSeriesSheet）。全部うまくいけば閉じ、
 * 一部失敗したら件数と失敗したものを出す
 */
export function RenameSheet({ kind, id, current, videoCount, open, onClose, onDone }: {
  kind: 'folder' | 'series'; id: number; current: string; videoCount?: number; open: boolean; onClose: () => void;
  onDone: (newId: number | null) => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed>(undefined);
  const changed = !!name.trim() && name.trim() !== current;
  const folder = kind === 'folder';

  const submit = async () => {
    if (!changed || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (folder) {
        const r = await api.library.renameFolder(id, name.trim());
        setResult(tx('library.albumSheets.moved', { v0: r.moved, v1: r.total }));
        setFailed(r.failed);
        if (!r.failed?.length) onDone(r.new_album_id ?? null);
      } else {
        const r = await api.library.renameSeries(id, name.trim());
        setResult(tx('library.albumSheets.changedFileNamesChanged', { v0: r.renamed, v1: r.total, v2: r.renamed_files }));
        setFailed(r.failed);
        if (!r.failed?.length) onDone(r.new_series_id ?? null);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : folder ? tx('common.moveFailed') : tx('library.albumSheets.changeFailed')); } finally { setBusy(false); }
  };

  return (
    <ScrollSheet open={open} busy={busy} onClose={onClose}>
      <T size={13} w={800}>{folder ? tx('common.renameFolder') : tx('common.renameSeries')}</T>
      <T mono size={10} dim style={styles.mb14}>{folder ? tx('library.albumSheets.moveAllVideos') : tx('library.albumSheets.changeAllVideos', { v0: videoCount ?? 0 })}</T>
      <T mono size={10} dim style={styles.label}>{tx('library.albumSheets.current')}</T>
      <View style={[styles.current, { backgroundColor: theme.surface2, borderColor: theme.line }]}><T size={12}>{current}</T></View>
      <T mono size={10} dim style={styles.label}>{folder ? tx('library.albumSheets.newFolderName') : tx('library.albumSheets.newSeriesName')}</T>
      <TextInput value={name} onChangeText={setName} editable={!busy} autoCorrect={false}
        style={[styles.input, { borderColor: theme.frame, backgroundColor: theme.bg, color: theme.ink }]} />
      <T mono size={10} dim style={styles.note}>
        {folder
          ? tx('library.albumSheets.movesMp4TagJson')
          : tx('library.albumSheets.rewritesSeriesNameTag')}
      </T>
      {!!err && <T size={11} color={oklch(0.62, 0.22, 25)} style={styles.mt10}>{err}</T>}
      {result && <View style={styles.mt10}><T size={11}>{result}</T><FailedList failed={failed} /></View>}
      <Buttons busy={busy} ok={changed && !busy} cancel={result ? tx('common.close') : tx('common.cancel')} go={busy ? (folder ? tx('library.albumSheets.moving') : tx('library.albumSheets.changing')) : folder ? tx('library.albumSheets.move') : tx('library.albumSheets.change')}
        onCancel={onClose} onGo={() => void submit()} />
    </ScrollSheet>
  );
}

/** アルバムの動画を全部消す（元の PurgeAlbumSheet）。確かめるためにアルバム名を打ってもらう */
export function PurgeAlbumSheet({ albumId, name, videoCount, folders, open, onClose, onDone }: {
  albumId: number; name: string; videoCount: number; folders: string[]; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = typed.trim() === name && !busy;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setErr('');
    try { await api.library.deleteAlbum(albumId); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : tx('common.deleteFailed')); setBusy(false); }
  };
  return (
    <ScrollSheet open={open} busy={busy} onClose={onClose}>
      <T size={13} w={800} color={RED}>{tx('library.albumSheets.deleteAllVideos')}</T>
      <T mono size={10} dim style={styles.mb14}>{tx('library.albumSheets.deleteDbFolders')}</T>
      <View style={[styles.warn, { borderColor: RED }]}>
        <T size={12} w={800} color={RED} style={styles.mb6}>{tx('library.albumSheets.cantUndone')}</T>
        <T size={11} style={styles.lh}>
          <T size={11} w={800}>{name}</T> {tx('library.albumSheets.ofVideos')} <T size={11} w={800}>{tx('common.videos', { v0: videoCount })}</T>を恒久削除します。mp4・tag.json・サムネを消し、DBの行も消します。動画が無くなって空になったフォルダも削除します。
        </T>
        {folders.length > 0 && <T mono size={9} dim style={styles.mt6}>{tx('library.albumSheets.folders', { v0: folders.join(' / ') })}</T>}
      </View>
      <T mono size={10} dim style={styles.label}>{tx('library.albumSheets.typeAlbumNameConfirm')}</T>
      <TextInput value={typed} onChangeText={setTyped} editable={!busy} placeholder={name} placeholderTextColor={theme.mute} autoCorrect={false}
        style={[styles.input, { borderColor: ok ? RED : theme.line, backgroundColor: theme.bg, color: theme.ink }]} />
      {!!err && <T size={11} color={RED} style={styles.mt10}>{err}</T>}
      <Buttons busy={busy} ok={ok} danger cancel={tx('common.cancel')} go={busy ? tx('common.deleting2') : tx('library.albumSheets.deleteVideos', { v0: videoCount })} onCancel={onClose} onGo={() => void submit()} />
    </ScrollSheet>
  );
}

const styles = StyleSheet.create({
  mb6: { marginBottom: 6 },
  mb14: { marginBottom: 14 },
  mt6: { marginTop: 6 },
  mt10: { marginTop: 10 },
  label: { marginBottom: 4 },
  current: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  input: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, fontSize: 13 },
  note: { marginTop: 6, lineHeight: 15 },
  warn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, marginBottom: 14, backgroundColor: 'rgba(220,60,60,0.10)' },
  lh: { lineHeight: 18 },
  failed: { marginTop: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, backgroundColor: 'rgba(220,60,60,0.10)' },
  btns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  cancel: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  go: { flex: 1, padding: 12, borderRadius: 12, alignItems: 'center' } });
