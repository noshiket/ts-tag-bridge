import { reserveStatus, type ReserveDetail } from '@tstag/core';
import { useReserveActions } from '@tstag/core/react';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Skip, Trash, Tv } from '../../../ui/parts/Icons';
import { oklch } from '../../../ui/theme/oklch';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

const ORANGE = oklch(0.65, 0.18, 60);
const ORANGE_INK = oklch(0.45, 0.18, 60);
const RED = oklch(0.6, 0.22, 25);
const RED_INK = oklch(0.45, 0.22, 25);

/** 放送中か（その時だけライブに飛べる。元と同じ） */
const airingNow = (r: ReserveDetail) => {
  const st = r.start_time ? Date.parse(r.start_time) : NaN;
  const now = Date.now();
  return !!r.sid && !!r.onid && st <= now && now <= st + r.duration_sec * 1000;
};

/** 予約の操作: 放送中ならライブへ・スキップ/解除・削除（確かめてから） */
export function ReserveActions({ r, node, back }: { r: ReserveDetail; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const actions = useReserveActions(node);
  const [confirmDel, setConfirmDel] = useState(false);
  const skipped = reserveStatus(r, Date.now()) === 'skipped';
  return (
    <>
      <View style={styles.actions}>
        {airingNow(r) && (
          <Pressable onPress={() => router.push({ pathname: '/live', params: { sid: r.sid, onid: r.onid } })}
            style={[styles.live, { boxShadow: shadow(theme, 3, oklch(0.35, 0.18, 145)) }]}>
            <Tv s={16} c="#fff" /><T size={13} w={800} color="#fff">{tx('epg.live')}</T>
          </Pressable>
        )}
        <Pressable onPress={() => (skipped ? actions.unskip : actions.skip).mutate(r.reserve_id)}
          style={[styles.action, { borderColor: ORANGE, backgroundColor: skipped ? oklch(0.78, 0.16, 60) : 'transparent' }]}>
          <Skip s={14} c={skipped ? '#fff' : ORANGE_INK} />
          <T size={13} w={800} color={skipped ? '#fff' : ORANGE_INK}>{skipped ? tx('reservations.reserveActions.unskip') : tx('reservations.list.alert.skip')}</T>
        </Pressable>
        <Pressable onPress={() => setConfirmDel(true)} style={[styles.action, { borderColor: RED }]}>
          <Trash s={14} c={RED_INK} />
          <T size={13} w={800} color={RED_INK}>{tx('reservations.reserveActions.deleteReservation')}</T>
        </Pressable>
      </View>
      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title={tx('reservations.reserveActions.deleteReservation2')}>
        <View style={[styles.delInfo, { backgroundColor: theme.surface2 }]}>
          <T mono size={10} dim>{`del_reserve(${r.reserve_id}) — ${r.title}`}</T>
        </View>
        <View style={styles.delRow}>
          <Pressable onPress={() => setConfirmDel(false)} style={[styles.delBtn, { borderColor: theme.frame }]}>
            <T size={13} w={700}>{tx('common.cancel')}</T>
          </Pressable>
          <Pressable onPress={() => { setConfirmDel(false); actions.remove.mutate(r.reserve_id, { onSuccess: back }); }}
            style={[styles.delBtn, { borderColor: theme.frame, backgroundColor: RED }]}>
            <T size={13} w={800} color="#fff">{tx('common.delete2')}</T>
          </Pressable>
        </View>
      </Sheet>
    </>
  );
}

/** 「…」: EPG 同期（このサーバーの、ルールのある予約だけ） */
export function ReserveMoreSheet({ r, node, open, onClose }: { r: ReserveDetail; node: string | null; open: boolean; onClose: () => void }) {
  const { t: tx } = useT();
  const actions = useReserveActions(node);
  return (
    <Sheet open={open} onClose={onClose} title={tx('common.other')}>
      {r.rule_id != null && !node ? (
        <SheetItem first label={actions.syncEpg.isPending ? tx('reservations.reserveActions.syncing') : tx('reservations.reserveActions.syncSyncEpg')} sub={tx('reservations.reserveActions.refetchDescriptionGenreVideo')}
          onPress={() => { onClose(); actions.syncEpg.mutate(r.rule_id!); }} />
      ) : <T size={12} dim>{tx('reservations.reserveActions.noActionsAvailableReservation')}</T>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: 14, borderWidth: 1.5, backgroundColor: oklch(0.48, 0.18, 145), borderColor: oklch(0.35, 0.18, 145) },
  actions: { flexDirection: 'row', gap: 8, marginTop: 20, marginBottom: 8 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 14, borderWidth: 1.5 },
  delInfo: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 16 },
  delRow: { flexDirection: 'row', gap: 8 },
  delBtn: { flex: 1, padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
});
