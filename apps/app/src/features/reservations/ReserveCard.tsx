import { dateTimeWithYear, recordingProgress, reserveFolder, reserveStatus, reserveTimes, TUNER_SHORTAGE, type Reserve } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert, Trash } from '../../ui/parts/Icons';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { StationLogo } from '../../ui/parts/StationLogo';
import { Mark } from '../../ui/parts/Mark';
import { StatusPill } from '../../ui/parts/StatusPill';
import { T } from '../../ui/parts/T';
import { danger } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';
import { shadow } from '../../ui/theme/edge';
import { RECORDING, tunerLabel } from './views/parts';
import { useT } from '../../ui/i18n/I18n';

const OVERLAP = '#FF6853';
const DUP = '#816BD8';
const SHORTAGE = TUNER_SHORTAGE;

/** 予約一覧の1件（元の reservations.jsx のカード）。録画・ビデオのカードに合わせた作り。右下のごみ箱でスキップ・削除のシート */
export function ReserveCard({ r, now, thumb, tuner, onPress, onMenu }: {
  r: Reserve;
  now: number;
  /** 録画に使うチューナー（EDCB の割り当て。無効の予約など割り当てが無ければ undefined） */
  tuner?: string;
  /** 確定値のフォルダと同じ名前のアルバムのサムネ */
  thumb: { uri: string; headers?: Record<string, string> } | null;
  onPress?: () => void;
  onMenu?: () => void;
}) {
  useBgRenderCount('ReserveCard');
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const status = reserveStatus(r, now);
  const skipped = r.rec_enabled === 0;
  const t = reserveTimes(r);
  const folder = reserveFolder(r);
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.card, {
      opacity: skipped ? 0.5 : 1, backgroundColor: theme.surface,
      borderColor: r.overlap_mode ? OVERLAP : theme.cardFrame, boxShadow: shadow(theme, 3),
    }]}>
      {/* 録画・ビデオのカードと同じ作り: 大きいサムネの右に、小さく状態、大きく題名（2行分の高さ）、局と日時（年まで）、フォルダ。
          どのカードも同じ高さ（重なりは帯ではなくバッジで出す）。フォルダは下の段 */}
      <View style={styles.top}>
        <ReelThumb source={thumb} hue={hueFromId(r.reserve_id)} width={160} height={90} />
        <View style={styles.body}>
          <View style={styles.badges}>
            {/* 大事な順: 状態・チューナー不足 → 重なり・スキップ → 番号（右で切れても困らない順。チューナーは切れないよう下の段） */}
            <StatusPill status={status} />
            {tuner === SHORTAGE && <Badge bg={danger} fg="#fff" urgent>{tx('reservations.list.alert.shortage')}</Badge>}
            {!!r.overlap_mode && (
              <Mark bg={OVERLAP} fg="#fff" style={[styles.tag, styles.badge, styles.overlap]}>
                {(fg) => <><Alert s={9} c={fg} /><T mono size={7} w={800} color={fg}>{`OVERLAP:${r.overlap_mode}`}</T></>}
              </Mark>
            )}
            {skipped && (r.auto_skip_reason === 'duplicate'
              ? <Badge bg={DUP} fg="#fff">{tx('reservations.list.badge.skipDup')}</Badge>
              : <Badge bg={theme.ink} fg={theme.onInk}>SKIP</Badge>)}
            {!r.rule_id && !skipped && <Badge bg="#A7DFFF" fg="#00477B" w={700}>{tx('reservations.list.note.dbPlanned')}</Badge>}
            {r.duplicate_count > 0 && <Badge bg={DUP} fg="#fff">{tx('reservations.list.badge.registered')}</Badge>}
            <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={8} w={500} dim>{`resID:${r.reserve_id}`}</T></View>
          </View>
          <T size={15} w={800} numberOfLines={2} style={styles.title}>{r.title}</T>
          <View style={styles.station}>
            <StationLogo onid={r.onid} sid={r.sid} height={12} maxWidth={22} />
            <T size={11} dim numberOfLines={1} style={styles.shrink}>{r.station_name}</T>
          </View>
          <T size={11} dim numberOfLines={1}>{`${dateTimeWithYear(r.start_time)}–${t.end.slice(11)} · ${tx('unit.min', { n: t.durationMin })}`}</T>
        </View>
      </View>
      {/* 下の段: 確定値のフォルダと録画中の進み具合、右下にスキップ・削除のシート */}
      <View style={styles.bottom}>
        <View style={[styles.grow, styles.bottomLeft]}>
          {/* 使うチューナーとフォルダを1行に（チューナーは上のバッジの行に置くと、iPhone の幅では右で切れて見えなかった） */}
          {((tuner && tuner !== SHORTAGE) || (r.confirmed && Object.keys(r.confirmed).length > 0)) && (
            <View style={styles.folderRow}>
              {tuner && tuner !== SHORTAGE && (
                <View style={styles.folder}>
                  <T mono size={8} dim>tuner:</T>
                  <T mono size={9} w={700} numberOfLines={1}>{tunerLabel(tuner)}</T>
                </View>
              )}
              {r.confirmed && Object.keys(r.confirmed).length > 0 && (
                <View style={[styles.folder, styles.shrink]}>
                  <T mono size={8} dim>folder:</T>
                  <T mono size={9} w={folder ? 700 : 400} color={folder ? (theme.marks === 'quiet' ? theme.ink : accent.secondary) : theme.mute} numberOfLines={1} style={styles.shrink}>{folder || '—'}</T>
                </View>
              )}
            </View>
          )}
          {status === 'recording' && (
            <View style={[styles.progress, { backgroundColor: theme.surface2 }]}>
              <View style={{ width: `${recordingProgress(r, now) * 100}%`, height: '100%', backgroundColor: RECORDING }} />
            </View>
          )}
        </View>
        {onMenu && (
          <Pressable onPress={onMenu} hitSlop={6} accessibilityLabel={tx('reservations.list.menu')} style={[styles.trash, { borderColor: theme.line }]}>
            <Trash s={12} c={danger} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

function Badge({ children, bg, fg, w = 800, urgent }: { children: string; bg: string; fg: string; w?: 700 | 800; urgent?: boolean }) {
  return <Mark bg={bg} fg={fg} urgent={urgent} style={[styles.tag, styles.badge]}>{(c) => <T mono size={7} w={w} color={c} numberOfLines={1}>{children}</T>}</Mark>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 10, paddingHorizontal: 10, height: 104 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 18, overflow: 'hidden' },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  badge: { paddingVertical: 2, paddingHorizontal: 6 },
  overlap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  title: { lineHeight: 19, height: 38 },
  station: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  shrink: { flexShrink: 1 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, height: 40 },
  grow: { flex: 1 },
  bottomLeft: { minWidth: 0, gap: 4, justifyContent: 'center' },
  trash: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progress: { height: 5, borderRadius: 2, overflow: 'hidden' },
});
