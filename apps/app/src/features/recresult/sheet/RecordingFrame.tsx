import { REC_STEPS, commentsPerMin, recProgress, recordingTimes, reserveHeadline, type Recording } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FILM, useFilm } from './film';
import { PenMarks } from './PenMarks';
import { heatColor } from '../colors';
import { Trash } from '../../../ui/parts/Icons';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { trLabel, useT } from '../../../ui/i18n/I18n';

const per = (d: { comment_count: number | null; duration_sec: number | null }) => commentsPerMin(d.comment_count, d.duration_sec);

/**
 * コンタクトシートの 1 コマ。縁に処理の 5 段の目盛りと日時・局、コマの左上に処理の札（エンコ済は緑）、
 * ドロップ・スクランブルは赤ペンでコマに書き込み、右下に勢い。下に勢いの目盛り・題名・ライブラリの同じ回（局と勢いを全部）
 */
export function RecordingFrame({ r, node, maxPerMin, onOpen, onDelete }: {
  r: Recording;
  node: string | null;
  /** このページで一番の勢い（目盛りの長さの基準） */
  maxPerMin: number;
  onOpen?: () => void;
  onDelete: () => void;
}) {
  const api = useApi();
  const film = useFilm();
  const { t: tx } = useT();
  const [err, setErr] = useState(false);
  const p = recProgress(r);
  const done = p.kind === 'done';
  const pm = per(r);
  const t = recordingTimes({ ...r, eit_end_time: null });
  const h = reserveHeadline(r);
  const dups = [...(r.duplicate_info ?? [])].sort((a, b) => (per(b) ?? -1) - (per(a) ?? -1));
  const stateBg = done ? FILM.done : p.kind === 'error' ? FILM.pen : FILM.idle;
  return (
    <Pressable onPress={onOpen} onLongPress={onDelete} disabled={!onOpen && !onDelete}
      style={{ opacity: r.file_exist === false || r.file_exist === 0 ? 0.45 : 1 }}>
      <View style={styles.edge}>
        <View style={styles.dots}>
          {REC_STEPS.map((s, i) => <View key={s} style={[styles.dot, { backgroundColor: i < p.step ? (done ? FILM.done : film.edge) : film.hole }]} />)}
        </View>
        <Num size={9} color={film.edge} lines={1} style={styles.edgeText}>{`▶ ${t.start.slice(5, 16).replace('-', '/')} ${r.service_name}`}</Num>
      </View>
      <View style={[styles.pic, { borderColor: done ? FILM.done : '#000' }]}>
        {r.db_rec_id && !err
          ? <Image source={{ uri: api.recordings.thumbnailUrl(r.db_rec_id, node), headers: api.client.authHeaders() }}
              style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" onError={() => setErr(true)} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.45, 0.12, hueFromId(r.id)) }]} />}
        <PenMarks r={r} />
        <View style={[styles.state, { backgroundColor: stateBg }]}>
          <T size={10} w={900} color={done || p.kind === 'error' ? '#fff' : '#111'} style={GOTHIC} numberOfLines={1}>
            {`${done ? '✓ ' : ''}${trLabel(tx, 'state.rec', p.state, { [p.state]: p.label })}${p.node ? ` → ${p.node}` : ''}`}
          </T>
        </View>
        {pm != null && (
          <View style={styles.hot}>
            <Num size={20} color={heatColor(pm, '#9A9A9A')}>{String(pm)}</Num>
            <Num size={8} color="#bbb">{tx('unit.perMin')}</Num>
          </View>
        )}
      </View>
      <View style={[styles.meter, { backgroundColor: film.track }]}>
        {pm != null && <View style={{ height: '100%', width: `${Math.max(3, (pm / Math.max(maxPerMin, 1)) * 100)}%`, backgroundColor: heatColor(pm, film.sub) }} />}
      </View>
      <T size={12} w={900} color={film.text} numberOfLines={2} style={[GOTHIC, styles.title]}>{h.episode ? `${h.title} #${h.episode}` : h.title}</T>
      <View style={styles.subRow}>
        <T size={10} color={film.sub} numberOfLines={1} style={[GOTHIC, styles.shrink]}>
          {[tx('unit.min', { n: t.durationMin }), r.comment_count != null ? tx('recresult.sheet.live', { n: r.comment_count.toLocaleString() }) : ''].filter(Boolean).join(' · ')}
        </T>
        <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel={tx('recresult.rec.menu')}><Trash s={11} c={film.sub} /></Pressable>
      </View>
      <View style={styles.lib}>
        {dups.length > 0 && <T size={10} w={700} color={film.edge} style={GOTHIC}>{tx('recresult.sheet.sameEp', { n: dups.length })}</T>}
        {dups.length > 0 ? dups.map((d) => (
          <View key={d.id} style={[styles.cut, { borderLeftColor: d.has_issue ? FILM.pen : film.edge }]}>
            <T size={9.5} w={700} color="#DDD" style={GOTHIC}>{d.eit_station_name || tx('recresult.rec.unknownStation')}</T>
            {per(d) != null && <Num size={11} color={heatColor(per(d), '#9A9A9A')}>{String(per(d))}</Num>}
          </View>
        )) : <View style={[styles.cut, styles.none]}><T size={9.5} w={700} color="#777" style={GOTHIC}>{tx('recresult.sheet.sameEpNone')}</T></View>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  edge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 },
  dots: { flexDirection: 'row', gap: 2 },
  dot: { width: 9, height: 5 },
  shrink: { flexShrink: 1, minWidth: 0 },
  edgeText: { flexShrink: 1, minWidth: 0, textAlign: 'right' },
  pic: { aspectRatio: 16 / 9, borderWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  state: { position: 'absolute', left: 0, top: 0, paddingVertical: 2, paddingLeft: 5, paddingRight: 6, maxWidth: '100%' },
  hot: { position: 'absolute', right: 0, bottom: 0, flexDirection: 'row', alignItems: 'baseline', gap: 1, backgroundColor: 'rgba(0,0,0,0.82)', paddingLeft: 6, paddingRight: 5, paddingBottom: 2 },
  meter: { height: 4, marginTop: 3 },
  title: { marginTop: 4, lineHeight: 16 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 1 },
  lib: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, marginTop: 4 },
  cut: { flexDirection: 'row', alignItems: 'baseline', gap: 3, backgroundColor: FILM.chip, borderLeftWidth: 3, paddingHorizontal: 4, paddingVertical: 1 },
  none: { borderLeftColor: '#555' },
});
