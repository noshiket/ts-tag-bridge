import { useManuAdd } from '@tstag/core/react';
import { router, useLocalSearchParams } from 'expo-router';

import { ManuAddEditor } from '../../../features/autoadd/manu/ManuAddEditor';
import { NodeBadge } from '../../../features/library/NodeSwitcher';
import { DetailRouteShell } from '../../../features/shell/DetailRouteShell';
import { useT } from '../../../ui/i18n/I18n';

/**
 * プログラム予約の編集（元の ManuAddDetailScreen）。id が 'new' なら新規（毎日・EDCB の既定のプリセット）。
 * 予約条件（番組名・局1つ・開始と終了・曜日）と録画設定の2つのタブ。保存・削除すると一覧へ戻る。中身は features/autoadd/manu
 */
export default function ManuAddDetailScreen() {
  const { t: tx } = useT();
  const { id, node: nodeParam } = useLocalSearchParams<{ id: string; node?: string }>();
  const node = nodeParam || null;
  const isNew = id === 'new';
  const list = useManuAdd(node);
  const item = isNew ? null : list.data?.find((m) => m.id === Number(id));
  const back = () => router.replace('/autoreserve');
  return (
    <DetailRouteShell ready={isNew || !!item} title={tx('common.programReserve')} onBack={back} afterTitle={<NodeBadge node={node} />}
      message={list.error ? list.error.message : list.data ? 'ルールが見つかりません' : tx('common.loading')}>
      <ManuAddEditor key={`${id}-${node ?? ''}`} item={item ?? null} node={node} back={back} />
    </DetailRouteShell>
  );
}
