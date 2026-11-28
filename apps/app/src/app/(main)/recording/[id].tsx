import { useRecording } from '@tstag/core/react';
import { router, useLocalSearchParams } from 'expo-router';

import { RecordingDetailView } from '../../../features/recording-detail/RecordingDetail';
import { DetailRouteShell } from '../../../features/shell/DetailRouteShell';
import { useScreenNode } from '../../../lib/state/viewNode';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 録画詳細（元の detail_rec.jsx）。録画結果のカードから開く（このアプリの録画の番号で）。
 * 中身は features/recording-detail
 */
export default function RecordingDetailScreen() {
  const { t: tx } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  // 別のサーバーのアルバムなどへ飛んで戻った時も、この詳細のサーバーで出す
  const viewNode = useScreenNode();
  const q = useRecording(Number(id), viewNode);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/recresult'));
  return (
    <DetailRouteShell ready={!!q.data} title={tx('screens.recording.title')} onBack={back} message={q.error ? q.error.message : tx('common.loading')}>
      {q.data && <RecordingDetailView r={q.data} node={viewNode} back={back} />}
    </DetailRouteShell>
  );
}
