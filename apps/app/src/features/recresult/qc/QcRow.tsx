import { REC_STEPS, commentsPerMin, recProgress, recordingTimes, reserveHeadline, type Recording } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { heatColor } from '../colors';
import { FILM } from '../sheet/film';
import { PenMarks } from '../sheet/PenMarks';
import { Trash } from '../../../ui/parts/Icons';
import { hueFromId } from '../../../ui/parts/ReelThumb';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { oklch } from '../../../ui/theme/oklch';
import { useTheme } from '../../../ui/theme/Tweaks';
import { trLabel, useT } from '../../../ui/i18n/I18n';

export const NG_RED = '#D7261E';
const PANEL = '#1A1A1A';
const DONE = FILM.done;
const per = (d: { comment_count: number | null; duration_sec: number | null }) => commentsPerMin(d.comment_count, d.duration_sec);

/**
 * 検査票の 1 行（映像の納品検査の作法: 問題は 1 件ずつ書く）。左の列に処理の状態（キュー・待機・完了など）を縦に、サムネに赤ペンでドロップ、
 * 右に勢いの大きな数字、ライブラリの同じ回を全部（この録画より熱い一番に ▲）、下に処理の 5 段
 */
export function QcRow({ r, node, onOpen, onDelete }: { r: Recording; node: string | null; onOpen?: () => void; onDelete: () => void }) {
  const api = useApi();
  const { theme } = useTheme();
  const { t: tx } = useT();
  const [err, setErr] = useState(false);
  const pm = per(r);
  const p = recProgress(r);
  const label = trLabel(tx, 'state.rec', p.state, { [p.state]: p.label });
  const t = recordingTimes({ ...r, eit_end_time: null });
  const h = reserveHeadline(r);
  const dups = [...(r.duplicate_info ?? [])].sort((a, b) => (per(b) ?? -1) - (per(a) ?? -1));
  const top = dups[0] && (per(dups[0]) ?? -1) > (pm ?? -1) ? dups[0] : null;
  return (
    <Pressable onPress={onOpen} onLongPress={onDelete} disabled={!onOpen}
      style={[styles.row, { borderColor: theme.frame, backgroundColor: theme.surface, opacity: r.file_exist === false || r.file_exist === 0 ? 0.45 : 1 }]}>
      {/* 左の列: 処理の状態を縦書きで（完了は緑、失敗などは赤） */}
      <View style={[styles.judge, { borderColor: theme.frame, backgroundColor: p.kind === 'done' ? DONE : p.kind === 'error' ? NG_RED : theme.surface2 }]}>
        {[...(p.kind === 'done' ? tx('recresult.qc.done') : label)].map((c, i) => (
          <T key={i} size={13} w={900} color={p.kind === 'working' ? theme.ink : '#fff'} style={[GOTHIC, styles.vchar]}>{c === 'ー' ? '｜' : c}</T>
        ))}
      </View>
      <View style={styles.main}>
        <View style={[styles.top, { borderColor: theme.frame }]}>
          <View style={[styles.pic, { borderColor: theme.frame }]}>
            {r.db_rec_id && !err
              ? <Image source={{ uri: api.recordings.thumbnailUrl(r.db_rec_id, node), headers: api.client.authHeaders() }}
                  style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" onError={() => setErr(true)} />
              : <View style={[StyleSheet.absoluteFill, { backgroundColor: oklch(0.55, 0.12, hueFromId(r.id)) }]} />}
            <PenMarks r={r} size={56} />
          </View>
          <View style={styles.heat}>
            <T size={9} color="#aaa" style={GOTHIC}>{tx('recresult.qc.heat')}</T>
            <Num size={30} color={heatColor(pm, '#8A8A8A')}>{pm == null ? '—' : String(pm)}</Num>
            <Num size={10} color="#aaa">{tx('unit.perMin')}</Num>
            <T size={10} w={700} color="#ccc" style={[GOTHIC, styles.count]}>{r.comment_count != null ? tx('recresult.rec.comments', { n: r.comment_count.toLocaleString() }) : ''}</T>
          </View>
        </View>
        <View style={styles.meta}>
          <Num size={11} color={theme.mute} lines={1} style={styles.shrink}>{`${t.start.slice(5, 16).replace('-', '/')}  ${r.service_name}  ${tx('unit.min', { n: t.durationMin })}`}</Num>
          <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel={tx('recresult.rec.menu')} style={styles.trash}><Trash s={12} c={theme.mute} /></Pressable>
        </View>
        <T size={14} w={900} numberOfLines={2} style={[GOTHIC, styles.title]}>{h.episode ? `${h.title} #${h.episode}` : h.title}</T>
        <View style={[styles.lib, { borderColor: theme.frame }]}>
          <View style={styles.libHead}>
            <T size={9} dim style={GOTHIC}>{dups.length ? tx('recresult.qc.libDup', { n: dups.length }) : tx('recresult.qc.libDupNone')}</T>
            {!dups.length && <T size={11} w={700} dim style={GOTHIC}>{tx('recresult.qc.none')}</T>}
          </View>
          {dups.length > 0 && (
            <View style={styles.chips}>
              {dups.map((d) => (
                <View key={d.id} style={[styles.chip, d === top && styles.top1, d.has_issue && { borderColor: NG_RED }]}>
                  <T size={10.5} w={700} color="#fff" style={GOTHIC}>{`${d === top ? '▲ ' : ''}${d.eit_station_name || tx('recresult.rec.unknownStation')}`}</T>
                  {per(d) != null && <Num size={13} color={heatColor(per(d), '#9A9A9A')}>{String(per(d))}</Num>}
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={styles.steps}>
          {REC_STEPS.map((s, i) => {
            const on = i < p.step;
            const now = i === p.step - 1 && p.kind !== 'done';
            // エンコ済は最後の段を緑で塗って「✓ 完了」（コンタクトシートの札と同じ色）
            const fin = p.kind === 'done' && i === REC_STEPS.length - 1;
            const bg = fin ? DONE : now ? (p.kind === 'error' ? NG_RED : theme.ink) : on ? theme.surface2 : 'transparent';
            const fg = fin || (now && p.kind === 'error') ? '#fff' : now ? theme.onInk : on ? theme.ink : theme.mute;
            return (
              <View key={s} style={[styles.step, { borderColor: fin ? DONE : on ? theme.frame : theme.line, backgroundColor: bg }]}>
                <T size={9.5} w={700} numberOfLines={1} color={fg} style={GOTHIC}>
                  {fin ? tx('recresult.qc.finished') : now ? `${label}${p.node ? `→${p.node}` : ''}` : trLabel(tx, 'state.recStep', i)}
                </T>
              </View>
            );
          })}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderWidth: 1 },
  judge: { width: 32, alignItems: 'center', paddingTop: 9, borderRightWidth: 1 },
  vchar: { lineHeight: 15 },
  main: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 9 },
  top: { flexDirection: 'row', borderWidth: 1 },
  pic: { flex: 1, aspectRatio: 16 / 9, borderRightWidth: 1, overflow: 'hidden', backgroundColor: '#000' },
  // 勢いの欄は数字が収まる幅だけ（サムネを大きく）
  heat: { width: 66, backgroundColor: PANEL, paddingHorizontal: 7, paddingVertical: 5 },
  count: { marginTop: 'auto' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  shrink: { flexShrink: 1, minWidth: 0 },
  trash: { marginLeft: 'auto' },
  title: { lineHeight: 19, marginTop: 1, marginBottom: 5 },
  lib: { borderWidth: 1, paddingHorizontal: 6, paddingTop: 3, paddingBottom: 5 },
  libHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  chip: { flexDirection: 'row', alignItems: 'baseline', gap: 4, backgroundColor: '#222', borderWidth: 1, borderColor: '#222', paddingHorizontal: 5, paddingVertical: 1 },
  top1: { borderColor: '#fff', borderWidth: 2 },
  steps: { flexDirection: 'row', gap: 3, marginTop: 6 },
  step: { flex: 1, borderWidth: 1, alignItems: 'center', paddingVertical: 2 },
});
