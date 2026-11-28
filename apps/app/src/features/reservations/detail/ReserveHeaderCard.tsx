import { reserveStatus, reserveTimes, type ReserveDetail } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { Card, Tag } from '../../detail/Card';
import { MetaGrid, MetaRow } from '../../detail/MetaRow';
import { oklch } from '../../../ui/theme/oklch';
import { ReelThumb, hueFromId } from '../../../ui/parts/ReelThumb';
import { StationLogo } from '../../../ui/parts/StationLogo';
import { StatusPill } from '../../../ui/parts/StatusPill';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useReserveThumb } from '../useReserveThumb';
import { useT } from '../../../ui/i18n/I18n';

/** 予約の見出しのカード: サムネ・番号・状態・無料/有料・番組名・局と番組の識別・放送と録画の値 */
export function ReserveHeaderCard({ r }: { r: ReserveDetail }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const status = reserveStatus(r, Date.now());
  const t = reserveTimes(r);
  const thumb = useReserveThumb()(r);
  return (
    <Card>
      <View style={styles.headRow}>
        <ReelThumb source={thumb} hue={hueFromId(r.reserve_id)} size={64} />
        <View style={styles.grow}>
          <View style={styles.badges}>
            <Tag bg={theme.ink} fg={theme.onInk}>{`R-${r.reserve_id}`}</Tag>
            <Tag bg={theme.surface2} fg={theme.mute}>{`resID:${r.reserve_id}`}</Tag>
            <StatusPill status={status} />
            {r.free_ca === true && <Tag bg={oklch(0.82, 0.2, 135)} fg="#fff">FREE</Tag>}
            {r.free_ca === false && <Tag bg={oklch(0.6, 0.22, 25)} fg="#fff">{tx('epg.paid')}</Tag>}
          </View>
          <T range size={15} w={700} style={styles.title}>{r.title}</T>
        </View>
      </View>
      <View style={[styles.ids, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.05)' }]}>
        <T mono size={9} dim style={styles.ls}>SERVICE ID / EVENT ID</T>
        <T range mono size={10} w={700} color={accent.tertiary}>{`${r.onid}-${r.tsid}-${r.sid}`}</T>
        <T mono size={10} w={700} color={accent.primary} style={styles.gap2}>
          {`${r.onid}-${r.tsid}-${r.sid}-${r.event_id}`}<T mono size={8} color={accent.primary} style={styles.dim}>  (add_reserve ID)</T>
        </T>
      </View>
      <MetaGrid>
        <MetaRow label={tx('common.station')} value={r.station_name} logo={<StationLogo onid={r.onid} sid={r.sid} height={20} maxWidth={36} />} />
        <MetaRow label={tx('common.genre')} value={r.genre} />
        <MetaRow label={tx('common.start2')} value={t.start} />
        <MetaRow label={tx('common.end')} value={t.end} />
        <MetaRow label={tx('common.duration')} value={t.durationMin ? tx('common.min', { v0: t.durationMin }) : ''} />
        <MetaRow label={tx('reservations.reserveHeaderCard.sizeEst')} value={r.size} />
        <MetaRow label={tx('epg.video')} value={r.video_info} />
        <MetaRow label={tx('epg.audio')} value={r.audio_info} />
      </MetaGrid>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', gap: 11, marginBottom: 10 },
  grow: { flex: 1, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 4 },
  title: { lineHeight: 19 },
  ids: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 10 },
  ls: { letterSpacing: 0.5, marginBottom: 4 },
  gap2: { marginTop: 2 },
  dim: { opacity: 0.7 },
});
