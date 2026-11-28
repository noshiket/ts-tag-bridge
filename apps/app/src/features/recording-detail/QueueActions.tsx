import { canQueueRecording, isQueuedRecording, type RecordingDetail } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { REC_QUEUED, REC_RED } from './recColors';
import { Queue } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * エンコードのキューへの追加（待機・エラーの時だけ）と、入っている分を消して入れ直す（2回押して確かめる）。
 * 優先度 1〜5（既定 3）は追加・入れ直しの時に使い、高い順に実行される
 */
export function QueueActions({ r, node, onChanged }: { r: RecordingDetail; node: string | null; onChanged: () => Promise<unknown> }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [priority, setPriority] = useState(3);
  const [msg, setMsg] = useState<null | 'queueing' | 'ok' | string>(null);
  const [arm, setArm] = useState(false);
  const dbRecId = r.db_rec_id!;
  const canQueue = canQueueRecording(r.state);
  const queued = r.state === 'queued';
  const inQueue = isQueuedRecording(r.state);
  const err = msg && msg !== 'queueing' && msg !== 'ok' ? msg : null;
  const run = async (fn: () => Promise<unknown>) => {
    if (msg === 'queueing') return;
    setMsg('queueing');
    try {
      await fn();
      await onChanged();
      setMsg('ok');
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const disabled = !canQueue || msg === 'queueing' || queued;
  const bg = msg === 'ok' || queued ? REC_QUEUED : err ? REC_RED : canQueue ? accent.primary : theme.line;
  const label = msg === 'queueing' ? tx('common.registering2') : msg === 'ok' || queued ? tx('recresult.rec.queued') : err ? `✗ ${err}` : tx('recordingDetail.queueActions.addEncodeQueue');
  return (
    <View style={styles.queue}>
      {(canQueue || inQueue) && (
        <View style={styles.prio}>
          <T mono size={9} dim>{tx('common.priority')}</T>
          {[1, 2, 3, 4, 5].map((p) => (
            <Pressable key={p} onPress={() => setPriority(p)}
              style={[styles.prioBtn, { backgroundColor: priority === p ? accent.primary : theme.surface2, borderColor: priority === p ? theme.ink : theme.line }]}>
              <T mono size={11} w={800} color={priority === p ? '#fff' : theme.mute}>{String(p)}</T>
            </Pressable>
          ))}
          <T mono size={8} dim style={styles.dim}>{tx('common.higherRunsFirst')}</T>
        </View>
      )}
      <Pressable onPress={() => void run(() => api.recordings.queue(dbRecId, priority, node))} disabled={disabled}
        style={[styles.big, { backgroundColor: bg, borderColor: theme.frame, boxShadow: disabled ? 'none' : shadow(theme, 3) }]}>
        <Queue s={16} c="#fff" /><T size={13} w={800} color="#fff">{label}</T>
      </Pressable>
      {!canQueue && !queued && msg == null && (
        <T size={9} dim style={styles.center}>{r.state ? tx('recordingDetail.queueActions.stateCantQueuedWaiting', { v0: r.state }) : tx('recordingDetail.queueActions.cantQueueNotDb')}</T>
      )}
      {inQueue && (
        <Pressable disabled={msg === 'queueing'}
          onPress={() => { if (arm) { setArm(false); void run(() => api.recordings.requeue(dbRecId, priority, node)); } else { setArm(true); setTimeout(() => setArm(false), 4000); } }}
          style={[styles.big, styles.requeue, { backgroundColor: arm ? REC_RED : theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
          <Queue s={14} c={arm ? '#fff' : theme.ink} />
          <T size={12} w={800} color={arm ? '#fff' : theme.ink}>{arm ? tx('recordingDetail.queueActions.tapAgainRunRemoves') : tx('recordingDetail.queueActions.removeEncodeQueueRe')}</T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  queue: { marginTop: 20, gap: 0 },
  prio: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 8 },
  prioBtn: { width: 26, height: 22, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.7 },
  big: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 13, borderWidth: 1.5 },
  requeue: { marginTop: 8, padding: 10 },
  center: { textAlign: 'center', marginTop: 4 },
});
