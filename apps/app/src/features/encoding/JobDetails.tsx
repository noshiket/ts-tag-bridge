import type { EncodeRow } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { JOB_RED, errText } from './jobShared';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { Select } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 詳細 / DETAILS: このエンコードの確定値。優先度は待機中だけ、出力先はいつでも変えられる（アドオンの仕事は出力先が無い） */
export function JobDetails({ e, node, refresh }: { e: EncodeRow; node: string | null; refresh: () => Promise<unknown> }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const api = useApi();
  const opts = useQuery({ queryKey: ['encodeOptions', node ?? ''], queryFn: () => api.confirmed.encodeOptions(node) });
  const dirs = opts.data?.encode_dir_list ?? [];
  const peer = opts.data?.library_peer_name ?? null;
  const [dir, setDir] = useState(e.encodeDir);
  const [dirMsg, setDirMsg] = useState('');
  useEffect(() => { setDir(e.encodeDir); setDirMsg(''); }, [e.encodeDir]);
  const rows = ([
    ['ID', String(e.id)],
    [tx('encoding.job.step'), e.addonStep ?? ''],
    [tx('library.musicSort.title'), e.title],
    [tx('encoding.job.folder'), e.folder],
    [tx('encoding.job.episode'), e.episodeNumber ? `#${e.episodeNumber}` : ''],
    [tx('common.subtitle'), e.episodeName],
    [tx('common.output'), e.outputPath],
  ] as const).filter(([, v]) => v);
  const saveDir = () => {
    setDirMsg(tx('common.saving'));
    api.encodes.update(e.id, { encode_dir: dir }, node).then(() => refresh()).then(() => setDirMsg(tx('common.saved2')))
      .catch((err: unknown) => setDirMsg(tx('common.failed', { v0: errText(err) })));
  };
  const setPriority = (p: number) => { if (p !== e.priority) api.encodes.update(e.id, { priority: p }, node).then(() => refresh()).catch(() => {}); };
  const dirOptions = [
    { value: '', label: peer ? tx('common.defaultIs', { v: 'master' }) : dirs[0] ? tx('common.defaultIs', { v: dirs[0] }) : tx('common.default') },
    ...(peer ? [{ value: 'master', label: tx('common.masterSend', { v0: peer }) }] : []),
    ...dirs.map((d) => ({ value: d, label: d })),
    ...(dir && dir !== 'master' && !dirs.includes(dir) ? [{ value: dir, label: tx('common.notRegistered', { v0: dir }) }] : []),
  ];
  const line = { borderBottomWidth: 1, borderBottomColor: theme.line };
  return (
    <View style={styles.mb14}>
      <SectionTitle>{tx('common.details')}</SectionTitle>
      <View style={[styles.detail, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {rows.map(([label, value]) => (
          <View key={label} style={[styles.row, line]}>
            <T mono size={9} w={700} dim style={styles.label}>{label}</T>
            <T mono size={10} style={styles.grow}>{value}</T>
          </View>
        ))}
        <View style={[styles.row, styles.center, !e.isAddon && line]}>
          <T mono size={9} w={700} dim style={styles.label}>{tx('common.priority')}</T>
          {e.state === 'wait_encode' ? (
            <View style={styles.row4}>
              {[1, 2, 3, 4, 5].map((p) => {
                const on = e.priority === p;
                return (
                  <Pressable key={p} onPress={() => setPriority(p)}
                    style={[styles.prio, { backgroundColor: on ? accent.primary : theme.surface2, borderColor: on ? theme.ink : theme.line }]}>
                    <T mono size={10} w={800} color={on ? '#fff' : theme.mute}>{String(p)}</T>
                  </Pressable>
                );
              })}
              <T mono size={8} dim style={styles.dim}>{tx('common.higherRunsFirst')}</T>
            </View>
          ) : (
            <T mono size={10}>{`P${e.priority}`}<T mono size={8} dim>{tx('encoding.jobDetails.onlyChangeableWhileWait')}</T></T>
          )}
        </View>
        {!e.isAddon && (
          <View style={[styles.row, styles.center]}>
            <T mono size={9} w={700} dim style={styles.label}>{tx('encoding.jobDetails.outputDirectory')}</T>
            <View style={styles.grow}><Select value={dir} options={dirOptions} onChange={setDir} label={tx('encoding.jobDetails.outputDirectory')} /></View>
            {dir !== e.encodeDir && (
              <Pressable onPress={saveDir} style={[styles.save, { backgroundColor: theme.surface2, borderColor: theme.frame }]}><T mono size={10} w={700}>{tx('common.save')}</T></Pressable>
            )}
            {!!dirMsg && <T mono size={9} color={dirMsg.startsWith(tx('state.rec.encode_error')) ? JOB_RED : theme.mute}>{dirMsg}</T>}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mb14: { marginBottom: 14 },
  grow: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center' },
  row4: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detail: { borderWidth: 1.5, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 7, paddingHorizontal: 12 },
  label: { width: 88, flexShrink: 0 },
  prio: { width: 24, height: 20, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.7 },
  save: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1 },
});
