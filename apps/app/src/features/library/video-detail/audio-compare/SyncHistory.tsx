import { syncMethodLabel, type AddedTracks, type SyncRecord } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CMP_RED, CmpBtn, cmpStyles, useBoxStyle } from './compareParts';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/** 取り込んだ時の時間の対応（どの区間をどれだけずらしたか）。押すと区間ごとのずれと放送時刻 */
export function SyncRecords({ records }: { records: SyncRecord[] }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const box = useBoxStyle();
  const [open, setOpen] = useState<number | null>(null);
  if (records.length === 0) return null;
  return (
    <>
      <T size={10} w={700}>{tx('library.syncHistory.syncUsedImport')}</T>
      {records.map((rec, i) => {
        const s = rec.source ?? {};
        const ng = (rec.ranges ?? []).filter((r) => r.video_judged && Math.abs(r.video_frame_offset ?? 0) > 2);
        return (
          <View key={i} style={box}>
            <Pressable onPress={() => setOpen(open === i ? null : i)} style={styles.head}>
              <T size={10}>{`${s.station || '取り込み元'} · ${(rec.ranges ?? []).length}区間 · ${syncMethodLabel(rec.method)}${Object.entries(rec.added ?? {}).map(([k, v]) => ` · ${k === 'captions' ? '字幕' : 'コメント'}${v.count}件`).join('')}`}</T>
              <T mono size={9} color={ng.length ? CMP_RED : theme.mute}>
                {`${(rec.applied_at || '').slice(0, 16).replace('T', ' ')}${s.eit_start_time ? ` / 放送 ${s.eit_start_time.slice(0, 16).replace('T', ' ')}` : ''}${s.onid != null ? ` / ${s.onid}-${s.tsid}-${s.sid}-${s.eid}` : ''}${ng.length ? ` / 映像とずれた区間 ${ng.length}件` : ''}`}
              </T>
            </Pressable>
            {open === i && (
              <View style={styles.body}>
                {(rec.ranges ?? []).map((r, k) => (
                  <View key={k} style={[styles.range, { borderTopColor: theme.line }]}>
                    <T mono size={9} dim style={cmpStyles.grow}>{`${r.a_start.toFixed(0)}–${r.a_end.toFixed(0)}s`}</T>
                    <T mono size={9}>{`${(r.offset * 1000).toFixed(1)}ms`}</T>
                    <T mono size={9} dim>{r.video_judged ? tx('common.videoF', { v0: (r.video_frame_offset ?? 0) > 0 ? '+' : '', v1: r.video_frame_offset }) : tx('library.syncHistory.video')}</T>
                    <T mono size={9} dim style={styles.tot}>{`${(r.a_start_tot || '').slice(11, 19)} ← ${(r.b_start_tot || '').slice(11, 19)}`}</T>
                  </View>
                ))}
                <T mono size={9} dim style={cmpStyles.mt4}>
                  {tx('library.syncHistory.leftVideoRightSource', { v0: rec.method === 'audio_overlap' ? tx('library.syncHistory.audioFeaturesMatched500ms') : tx('library.syncHistory.audioMatchedPerSample') })}
                </T>
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

/** 取り込んだトラック（2回押すと消える） */
export function AddedTrackList({ tracks, busy, onDelete }: {
  tracks: AddedTracks | null; busy: boolean; onDelete: (body: { caption_index?: number; comment_key?: string }, label: string) => void;
}) {
  const { t: tx } = useT();
  const box = useBoxStyle();
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const rows = tracks ? [
    ...tracks.captions.map((t) => ({ label: tx('library.syncHistory.captions', { v0: t.name }), count: t.count, body: { caption_index: t.index } })),
    ...tracks.comments.map((t) => ({ label: tx('library.syncHistory.comments', { v0: t.key }), count: t.count, body: { comment_key: t.key } })),
  ] : [];
  if (rows.length === 0) return null;
  return (
    <>
      <T size={10} w={700}>{tx('library.syncHistory.addedTracks')}</T>
      {rows.map((t, i) => {
        const key = `${i}:${t.label}`;
        const armed = armedKey === key;
        return (
          <View key={key} style={[box, styles.track]}>
            <View style={cmpStyles.grow}><T size={10} numberOfLines={1}>{t.label}</T><T mono size={9} dim>{tx('common.items', { v0: t.count })}</T></View>
            <CmpBtn disabled={busy} onPress={() => { if (armed) { setArmedKey(null); onDelete(t.body, t.label); } else setArmedKey(key); }}
              color={armed ? '#fff' : CMP_RED} bg={armed ? CMP_RED : undefined} border={CMP_RED}>
              {armed ? '本当に削除' : tx('library.syncHistory.delete')}
            </CmpBtn>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  head: { paddingVertical: 6, paddingHorizontal: 9 },
  body: { paddingHorizontal: 9, paddingBottom: 7 },
  range: { flexDirection: 'row', gap: 6, borderTopWidth: 1, paddingVertical: 3 },
  tot: { flex: 1.4, textAlign: 'right' },
  track: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 9 },
});
