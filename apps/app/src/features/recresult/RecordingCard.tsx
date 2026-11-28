import { type MsgKey, REC_STATE_LABELS, REC_STATUS_LABELS, commentsPerMin, dateTimeWithYear, formatDurationJa, hasTelop, pickDuplicates, type Recording } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Lock, Trash } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { StationLogo } from '../../ui/parts/StationLogo';
import { Mark } from '../../ui/parts/Mark';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { DUP, ISSUE, OK_GREEN, PROTECT, RED, heatColor, recStateColor, recStatusColor } from './colors';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';
import { shadow } from '../../ui/theme/edge';
import { trLabel, useT, localizeFmt } from '../../ui/i18n/I18n';

const TRANSFER: Record<string, MsgKey> = {
  starting: 'recresult.recordingCard.preparing', waiting: 'recresult.recordingCard.waiting', sending: 'common.send', finalizing: 'recresult.recordingCard.registering', done: 'recresult.recordingCard.sent', already: 'recresult.recordingCard.sent', error: 'recresult.recordingCard.sendFailed',
};
const heat = (perMin: number, theme: { mute: string }) =>
  perMin >= 500 ? '#ff2d55' : perMin >= 200 ? '#ff6b35' : perMin >= 100 ? '#ff9f0a' : theme.mute;

/**
 * 録画結果の1件（元の history.jsx の RecInfoRow）。見やすさのため並びを変えた: 大きいサムネの右に、
 * 大事な順に大きさを変えて 題名 > 局・日時 > 状態・録画の結果（⚑）。下の段にカードの幅いっぱいで番号・ドロップ/スクランブル/
 * 勢い/重複と del（削除のシート）。どのカードも同じ高さ（題名は2行分、ほかは1行に収める）
 * ファイルの場所は詳細の画面で見る
 */
export function RecordingCard({ r, node, onDelete, onOpen }: { r: Recording; node: string | null; onDelete: () => void; onOpen?: () => void }) {
  useBgRenderCount('RecordingCard');
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const issue = r.drops > 0 || r.scrambles > 0;
  const perMin = commentsPerMin(r.comment_count, r.duration_sec);
  const delFg = theme.isDark ? oklch(0.82, 0.14, 25) : oklch(0.45, 0.22, 25);
  const t = r.transfer_state;
  const dups = pickDuplicates(r);
  return (
    <View style={[styles.card, {
      backgroundColor: theme.surface, boxShadow: shadow(theme, 3),
      borderColor: r.is_manual ? accent.tertiary : issue ? ISSUE : theme.cardFrame,
      opacity: r.file_exist === false || r.file_exist === 0 ? 0.45 : 1,
    }]}>
      <Pressable onPress={onOpen} disabled={!onOpen} style={styles.head}>
        <View style={styles.top}>
          <ReelThumb hue={hueFromId(r.id)} width={160} height={90}
            source={r.db_rec_id ? { uri: api.recordings.thumbnailUrl(r.db_rec_id, node), headers: api.client.authHeaders() } : null} />
          <View style={styles.body}>
            {/* 大事な順に大きく: 題名 > 局・日時 > 状態・勢いなど */}
            <View style={styles.titleRow}>
              {/* 1行の題名も2行分の高さを取る（カードの高さを揃える） */}
              <T size={15} w={800} numberOfLines={2} style={styles.title}>{r.title}</T>
              {onOpen && !r.is_manual && <T size={14} dim>›</T>}
            </View>
            <View style={styles.station}>
              <StationLogo onid={r.onid} sid={r.sid} height={12} maxWidth={22} />
              <T size={11} dim numberOfLines={1} style={styles.shrink}>
                {[r.service_name, dateTimeWithYear(r.start_time), localizeFmt(formatDurationJa(r.duration_sec))].filter(Boolean).join(' · ')}
              </T>
            </View>
            <View style={styles.badges}>
              {r.rec_status != null && <Badge bg={recStatusColor(r.rec_status, theme)}>{trLabel(tx, 'state.recStatus', r.rec_status, REC_STATUS_LABELS)}</Badge>}
              {r.state && <Badge bg={recStateColor(r.state, theme)}>{trLabel(tx, 'state.rec', r.state, REC_STATE_LABELS)}</Badge>}
              {t && (
                <Badge bg={t.phase === 'error' ? RED : t.phase === 'sending' ? accent.secondary : oklch(0.6, 0.16, 250)}>
                  {`⇪ ${t.node} ${TRANSFER[t.phase] ? tx(TRANSFER[t.phase]!) : t.phase}${t.phase === 'sending' && t.total > 0 ? ` ${Math.min(100, Math.round((t.sent / t.total) * 100))}%` : ''}`}
                </Badge>
              )}
              {r.is_manual && <Badge bg={accent.tertiary}>MANUAL</Badge>}
              {r.protect_flag && (
                <View style={[styles.tag, styles.badge, styles.protect, { backgroundColor: PROTECT }]}>
                  <Lock s={8} c="#fff" /><T mono size={7} w={800} color="#fff">PROTECT</T>
                </View>
              )}
              {issue && <Badge bg={ISSUE}>⚠ ISSUES</Badge>}
              {r.duplicate_info?.length > 0 && <Badge bg={DUP}>{tx('reservations.list.badge.registered')}</Badge>}
              {!!r.comment && (
                <T mono size={9} w={700} numberOfLines={1} style={styles.shrink} color={theme.isDark ? oklch(0.86, 0.12, 85) : oklch(0.45, 0.15, 60)}>{`⚑ ${r.comment}`}</T>
              )}
            </View>
          </View>
        </View>
        {/* 下の段（カードの幅いっぱい）: 番号・ドロップ/スクランブル（問題がある時だけ大きく赤く）・勢い・重複・del。折り返さず1行 */}
        <View style={styles.metrics}>
          <View style={styles.metricItems}>
            {/* 番号は recordings.id（DB に登録された録画の番号。登録前の録画には無い）。見分ける時だけ使うので小さく */}
            <T mono size={8} dim>{`recID:${r.db_rec_id ?? tx('recresult.rec.unregistered')}`}</T>
            <Metric label="DROP" value={r.drops} />
            <Metric label="SCR" value={r.scrambles} />
            {perMin != null && (
              <T size={10} w={700} color={heat(perMin, theme)}>{`🔥${tx('recresult.rec.comments', { n: (r.comment_count ?? 0).toLocaleString() })} ${perMin}${tx('unit.perMin')}`}</T>
            )}
            {dups.length > 0 && (() => {
              // 重複は最初の1件と残りの件数だけ（行を増やしてカードの高さを不揃いにしないため。全部は詳細で見る）
              const d = dups[0]!;
              const pm = commentsPerMin(d.comment_count, d.duration_sec);
              return (
                <T size={10} dim numberOfLines={1} style={styles.shrink}>
                  {`📼 ${d.eit_station_name || tx('recresult.rec.unknownStation')}`}
                  {pm != null && <T size={10} w={700} color={heatColor(pm, theme.mute)}>{` 🔥${pm}${tx('unit.perMin')}`}</T>}
                  {d.has_issue && <T size={10} w={800} color={RED}>{` ⚠${d.drop_count || 0}/${d.scramble_count || 0}`}</T>}
                  {hasTelop(d.announce) && <T size={10} w={800} color={oklch(0.65, 0.2, 55)}> 📢</T>}
                  {dups.length > 1 ? ` +${dups.length - 1}` : ''}
                </T>
              );
            })()}
          </View>
          {/* 右下: 削除のシート（ファイルの場所は詳細の画面で見る）。左の文字が長くても削らない */}
          <Pressable onPress={onDelete} hitSlop={6} accessibilityLabel={tx('recresult.rec.menu')} style={[styles.del, {
            backgroundColor: theme.isDark ? oklch(0.32, 0.09, 25) : oklch(0.92, 0.06, 25), borderColor: RED,
          }]}>
            <Trash s={9} c={delFg} /><T mono size={8} w={800} color={delFg}>del</T>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

function Badge({ children, bg }: { children: string; bg: string }) {
  return <Mark bg={bg} fg="#fff" style={[styles.tag, styles.badge]}>{(c) => <T mono size={7} w={800} color={c}>{children}</T>}</Mark>;
}

/** drops / scrambles。0 は小さく控えめ（緑）、あれば大きく赤く（問題がある時だけ目に入るように） */
function Metric({ label, value }: { label: string; value: number }) {
  const bad = value > 0;
  return (
    <View style={styles.metric}>
      <T mono size={8} dim>{label}</T>
      <T mono size={bad ? 13 : 9} w={800} color={bad ? RED : OK_GREEN}>{String(value)}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  head: { gap: 6, paddingVertical: 9, paddingHorizontal: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, height: 90 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, overflow: 'hidden', height: 16 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  badge: {},
  protect: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { flex: 1, lineHeight: 19, height: 38 },
  station: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 22 },
  metricItems: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  metric: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  del: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, flexShrink: 0 },
});
