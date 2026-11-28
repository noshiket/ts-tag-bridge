import { addonInitialValues, missingAddonParam, type AddonRunJob, type VideoAddon } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Select } from '../../ui/inputs/Select';
import { Switch } from '../../ui/inputs/Switch';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * アドオン1つの入力と実行（アドオンの params の宣言から入力欄を描き、動かして進み具合を見せる）。
 * アドオンごとの画面は作らない。サーバーにアドオンを置くだけで使える（アプリの作り直しは要らない）
 */
export function AddonRunner({ addon, run, node, onDone, trackOptions }: {
  addon: VideoAddon;
  /** 実行を頼む（動画・録画など、何に対して動かすかは呼ぶ側が決める） */
  run: (vals: Record<string, unknown>) => Promise<{ job_id: string }>;
  node: string | null;
  /** 終わった時（一覧の読み直しなど） */
  onDone?: () => void;
  /** 'comment_track' の項目の選択肢（その動画が持っているコメントのトラック） */
  trackOptions?: string[];
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [vals, setVals] = useState<Record<string, unknown>>(() => addonInitialValues(addon.params));
  const [job, setJob] = useState<AddonRunJob | null>(null);
  const [running, setRunning] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  useEffect(() => { setVals(addonInitialValues(addon.params)); setJob(null); }, [addon.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const watch = (jobId: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const j = await api.videoActions.addonJob(jobId, node);
        setJob(j);
        if (j.state !== 'running') {
          clearInterval(poll.current!);
          poll.current = null;
          setRunning(false);
          if (j.state === 'done') onDone?.();
        }
      } catch { /* 次の回にもう一度 */ }
    }, 1500);
  };
  const start = async () => {
    if (running) return;
    const miss = missingAddonParam(addon.params, vals);
    if (miss) { setJob({ state: 'error', error: tx('addons.addonRunner.enter', { v0: miss }), log: [] }); return; }
    setRunning(true);
    setJob({ state: 'running', log: [], result: null });
    try { watch((await run(vals)).job_id); } catch (e) {
      setRunning(false);
      setJob({ state: 'error', error: e instanceof Error ? e.message : String(e), log: [] });
    }
  };
  const set = (k: string, v: unknown) => setVals((p) => ({ ...p, [k]: v }));
  const input = [styles.input, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }];

  return (
    <View style={styles.body}>
      {(addon.params ?? []).map((p) => (
        <View key={p.key} style={styles.row}>
          <T mono size={9} dim style={styles.label}>{p.label}{p.required ? <T mono size={9} color="#ef4444"> *</T> : null}</T>
          <View style={styles.grow}>
            {p.type === 'bool' ? <Switch on={!!vals[p.key]} onChange={() => set(p.key, !vals[p.key])} label={p.label} />
              : p.type === 'comment_track' ? (
                <Select label={p.label} value={String(vals[p.key] ?? '')} onChange={(v) => set(p.key, v)} options={[
                  { value: '', label: tx('addons.addonRunner.newTrackNamedBoard') }, { value: 'comments', label: tx('addons.addonRunner.mainTrackAppendExisting') },
                  ...(trackOptions ?? []).map((k) => ({ value: k, label: k })),
                ]} />
              ) : p.type === 'select' ? (
                <Select label={p.label} value={String(vals[p.key] ?? '')} onChange={(v) => set(p.key, v)}
                  options={(p.options ?? []).map((o) => (typeof o === 'object' && o
                    ? { value: String((o as { value: unknown }).value), label: String((o as { label?: unknown }).label ?? (o as { value: unknown }).value) }
                    : { value: String(o), label: String(o) }))} />
              ) : (
                <TextInput value={vals[p.key] == null ? '' : String(vals[p.key])} keyboardType={p.type === 'number' ? 'numeric' : 'default'} autoCapitalize="none" autoCorrect={false}
                  onChangeText={(v) => set(p.key, p.type === 'number' ? (v === '' ? '' : Number(v)) : v)} style={input} />
              )}
          </View>
        </View>
      ))}
      <Pressable onPress={() => void start()} disabled={running} style={[styles.run, { backgroundColor: running ? theme.line : accent.primary }]}>
        <T mono size={11} w={800} color="#fff">{running ? tx('addons.addonRunner.running') : tx('addons.addonRunner.run')}</T>
      </Pressable>
      {job && (
        <View style={[styles.job, { backgroundColor: theme.surface2 }]}>
          <T mono size={9} w={800} color={job.state === 'error' ? '#ef4444' : job.state === 'done' ? accent.primary : theme.mute}>
            {job.state === 'running' ? tx('addons.runner.running') : job.state === 'done' ? tx('recresult.qc.finished') : `✗ ${job.error || tx('reservations.list.alert.error')}`}
          </T>
          {(job.log ?? []).slice(-6).map((l, i) => <T key={i} mono size={9} dim>{l}</T>)}
          {job.state === 'done' && job.result != null && <T mono size={9} style={styles.mt4}>{typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 1)}</T>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 6 },
  mt4: { marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { width: 96 },
  grow: { flex: 1, minWidth: 0 },
  input: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  run: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center' },
  job: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
});
