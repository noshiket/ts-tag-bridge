import { useReserve } from '@tstag/core/react';
import { router, useLocalSearchParams } from 'expo-router';

import { ReserveDetailView } from '../../../features/reservations/detail/ReserveDetailView';
import { DetailRouteShell } from '../../../features/shell/DetailRouteShell';
import { useScreenNode } from '../../../lib/state/viewNode';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 予約詳細（元の detail_res.jsx）。中身は features/reservations/detail
 */
export default function ReserveDetailScreen() {
  const { t: tx } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  // 別のサーバーのアルバムなどへ飛んで戻った時も、この詳細のサーバーで出す
  const viewNode = useScreenNode();
  const q = useReserve(Number(id), viewNode);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/reservations'));
  return (
    <DetailRouteShell ready={!!q.data} title={tx('common.reservationDetails')} onBack={back} message={q.error ? q.error.message : tx('common.loading')}>
      {q.data && <ReserveDetailView r={q.data} node={viewNode} back={back} />}
    </DetailRouteShell>
  );
}
