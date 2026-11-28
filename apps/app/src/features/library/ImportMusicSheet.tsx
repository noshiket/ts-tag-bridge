import { type CompareJob, type MusicFile } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ScrollSheet } from '../../ui/sheets/ScrollSheet';
import { Select } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * 音楽をフォルダごと取り込む（元の ImportMusicSheet）。① 中身を確かめ（埋め込みのタグを読むだけ）、② 再生用の MP4 へ変えて登録する。
 * 原本は動かさない。アーティストがアルバム、アルバムがその中の並びになる
 */
export function ImportMusicSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [dir, setDir] = useState('');
  const [destDir, setDestDir] = useState('');
  const [files, setFiles] = useState<MusicFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [job, setJob] = useState<CompareJob | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const roots = useQuery({ queryKey: ['addVideo', 'roots'], queryFn: () => api.addVideo.uploadRoots(), enabled: open });
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const scan = async () => {
    setBusy(true);
    setMsg('');
    setFiles(null);
    try {
      const r = await api.addVideo.scanMusic(dir.trim(), destDir);
      setFiles(r.files ?? []);
      if (!r.files?.length) setMsg(tx('library.importMusicSheet.noAudioFilesFound'));
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('library.importMusicSheet.scanFailed')); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { job_id } = await api.addVideo.importMusic(dir.trim(), destDir);
      poll.current = setInterval(async () => {
        try {
          const j = await api.audioCompare.job(job_id);
          setJob(j);
          if (j.state !== 'running' && j.state !== 'queued') {
            clearInterval(poll.current!);
            poll.current = null;
            setBusy(false);
            if (j.state === 'done') {
              const r = (j.result ?? {}) as { added?: number; skipped?: number; failed?: number };
              setMsg(tx('library.music.imported', { a: r.added, s: r.skipped ? tx('library.music.importedSkip', { n: r.skipped }) : '', f: r.failed ? tx('library.music.importedFail', { n: r.failed }) : '' }));
              void scan(); // 「登録済み」の印を直す
              onDone();
            }
          }
        } catch { clearInterval(poll.current!); poll.current = null; setBusy(false); }
      }, 2000);
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('common.couldntStart')); setBusy(false); }
  };
  const pending = (files ?? []).filter((f) => !f.registered);
  const first = roots.data?.[0];
  const opts = [
    { value: '', label: first ? tx('common.defaultIs', { v: first.path }) : tx('common.default') },
    ...(roots.data ?? []).map((r) => ({ value: r.path, label: `${r.path}${r.exists ? '' : ` (${tx('common.notMounted')})`}` })),
    { value: 'keep', label: tx('library.importMusicSheet.putSourceFolder') },
  ];

  return (
    <ScrollSheet open={open} onClose={onClose} busy={busy}>
      <T size={13} w={800}>{tx('library.importMusicSheet.importMusic')}</T>
      <T mono size={10} dim style={styles.intro}>
        {tx('library.importMusicSheet.convertsAudioFilesFolder')}
      </T>
      <TextInput value={dir} onChangeText={setDir} placeholder={tx('library.importMusicSheet.artist')} placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false}
        style={[styles.input, { backgroundColor: theme.surface2, borderColor: theme.line, color: theme.ink }]} />
      <T size={10} w={700} dim style={styles.label}>{tx('common.destinationEncodeDir')}</T>
      <Select label={tx('common.destination')} value={destDir} options={opts} onChange={setDestDir} />
      <T mono size={9} dim style={styles.hint}>{tx('library.importMusicSheet.placedEncodeDirFolder')}</T>
      <Pressable onPress={() => void scan()} disabled={busy || !dir.trim()} style={[styles.btn, { borderColor: theme.line, opacity: busy || !dir.trim() ? 0.6 : 1 }]}>
        <T mono size={11} w={800}>{busy && !job ? tx('library.importMusicSheet.checking') : tx('library.importMusicSheet.checkContents')}</T>
      </Pressable>
      {!!files?.length && (
        <ScrollView automaticallyAdjustKeyboardInsets style={[styles.files, { backgroundColor: theme.surface2, borderColor: theme.line }]} nestedScrollEnabled>
          {files.map((f, i) => (
            <View key={i} style={[styles.file, i > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
              <T mono size={9} color={f.registered ? theme.mute : theme.ink} style={styles.track}>{String(f.track || '–')}</T>
              <T mono size={9} color={f.registered ? theme.mute : theme.ink} numberOfLines={1} style={styles.grow}>{f.title}</T>
              <T mono size={9} color={f.registered ? theme.mute : theme.ink} numberOfLines={1} style={styles.grow}>{`${f.artist ?? ''} / ${f.album ?? ''}`}</T>
              {!f.cover && <T mono size={9} accessibilityLabel={tx('library.importMusicSheet.noEmbeddedCoverArt')}>🚫🖼</T>}
              {f.registered && <T mono size={9} dim>{tx('library.importMusicSheet.registered')}</T>}
            </View>
          ))}
        </ScrollView>
      )}
      {job && (job.state === 'running' || job.state === 'queued') && (
        <ScrollView automaticallyAdjustKeyboardInsets style={[styles.log, { backgroundColor: theme.surface2, borderColor: theme.line }]} nestedScrollEnabled>
          {job.state === 'queued' && <T mono size={9} dim>{tx('common.waitingLineOtherAnalysis')}</T>}
          {(job.log ?? []).slice(-6).map((l, i) => <T key={i} mono size={9} dim>{l}</T>)}
        </ScrollView>
      )}
      {!!files && pending.length > 0 && (
        <Pressable onPress={() => void run()} disabled={busy} style={[styles.go, { backgroundColor: busy ? theme.line : accent.primary }]}>
          <T mono size={11} w={800} color="#fff">{busy && job ? tx('library.importMusicSheet.importing') : tx('library.importMusicSheet.importTracksFewSeconds', { v0: pending.length })}</T>
        </Pressable>
      )}
      {!!msg && <T size={10} color={msg.startsWith(tx('common.imported')) ? accent.primary : '#ef4444'} style={styles.mt8}>{msg}</T>}
      <Pressable onPress={onClose} disabled={busy} style={[styles.btn, { borderColor: theme.line }]}><T mono size={11} w={700}>{tx('common.close')}</T></Pressable>
    </ScrollSheet>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: 2, marginBottom: 10, lineHeight: 16 },
  input: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, fontSize: 12, fontFamily: monoFamily[400] },
  label: { marginTop: 10, marginBottom: 4 },
  hint: { marginTop: 4, lineHeight: 15 },
  btn: { marginTop: 8, padding: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  files: { marginTop: 10, maxHeight: 220, borderRadius: 10, borderWidth: 1 },
  file: { flexDirection: 'row', gap: 6, paddingVertical: 5, paddingHorizontal: 9 },
  track: { width: 22 },
  grow: { flex: 1, minWidth: 0 },
  log: { marginTop: 10, maxHeight: 96, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1 },
  go: { marginTop: 8, padding: 10, borderRadius: 10, alignItems: 'center' },
  mt8: { marginTop: 8 } });
