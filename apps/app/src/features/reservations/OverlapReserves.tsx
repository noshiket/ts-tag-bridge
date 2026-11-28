import { overlappingReserves, tunerMapOf, type Reserve } from '@tstag/core';
import { useReserveActions, useReserves, useTunerReserves } from '@tstag/core/react';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { savedState } from '../../lib/state/savedState';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { ReserveActionSheet } from './ReserveActionSheet';
import { ReserveCard } from './ReserveCard';
import { useReserveThumb } from './useReserveThumb';
import { useT } from '../../ui/i18n/I18n';

/**
 * 予約詳細の「同時刻の予約」: 放送時間が重なる予約を予約一覧と同じカードで並べる（チューナーの取り合いを見るため）。
 * カードは予約一覧と同じ（右下のごみ箱でスキップ・削除）。重なる予約が無ければ何も出さない。
 * 見出しを押すと開け閉めする（既定は閉じる。件数が多いと詳細が長くなるため）。開け閉めは予約を移っても覚えておく
 */
const useOverlapState = savedState({ open: false });

export function OverlapReserves({ r, node, style }: { r: Reserve; node: string | null; style?: object }) {
  const reserves = useReserves(node);
  const tuners = useTunerReserves(node);
  const actions = useReserveActions(node);
  const [menu, setMenu] = useState<Reserve | null>(null);
  const [{ open }, set] = useOverlapState();
  const list = useMemo(() => overlappingReserves(r, reserves.data ?? []), [r, reserves.data]);
  const thumbOf = useReserveThumb();
  const { t: tx } = useT();
  const tunerOf = useMemo(() => (tuners.data ? tunerMapOf(tuners.data) : undefined), [tuners.data]);
  if (!list.length) return null;
  const now = Date.now();
  return (
    <View style={style}>
      <Pressable onPress={() => set({ open: !open })} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <SectionTitle>{`${tx('reservations.list.overlap', { n: list.length })} ${open ? '▲' : '▼'}`}</SectionTitle>
      </Pressable>
      {open && (
        <View style={styles.list}>
          {list.map((x) => (
            <ReserveCard key={x.reserve_id} r={x} now={now} thumb={thumbOf(x)} tuner={tunerOf?.get(x.reserve_id)} onMenu={() => setMenu(x)}
              onPress={() => router.push({ pathname: '/reserve/[id]', params: { id: x.reserve_id } })} />
          ))}
        </View>
      )}
      {/* 予約一覧と同じ操作（スキップ・削除） */}
      <ReserveActionSheet r={menu} onClose={() => setMenu(null)}
        onSkip={(x) => actions.skip.mutate(x.reserve_id)} onDelete={(x) => actions.remove.mutate(x.reserve_id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
});
