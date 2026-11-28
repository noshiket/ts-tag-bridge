import type { PendingAutoAdd } from '@tstag/core';
import { useAutoAdd } from '@tstag/core/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { AutoAddEditor } from '../../../features/autoadd/editor/AutoAddEditor';
import { pendingAutoAdd } from '../../../features/autoadd/pending';
import { NodeBadge } from '../../../features/library/NodeSwitcher';
import { DetailRouteShell } from '../../../features/shell/DetailRouteShell';
import { useT } from '../../../ui/i18n/I18n';

/**
 * EPG キーワード自動予約の編集（元の AutoAddDetailScreen）。id が 'new' なら新規（番組検索・番組のシートから条件を引き継ぐ）。
 * 中身は features/autoadd/editor
 */
export default function AutoAddDetailScreen() {
  const { t: tx } = useT();
  const { id, node: nodeParam, from } = useLocalSearchParams<{ id: string; node?: string; from?: string }>();
  const node = nodeParam || null;
  const isNew = id === 'new';
  const list = useAutoAdd(node);
  // 引き継ぎ（番組表・番組検索から）。URL の印で受け取る（画面が作り直されても同じ条件が届く）
  const pending = useMemo<PendingAutoAdd | null>(() => (isNew ? pendingAutoAdd(from) : null), [isNew, from]);
  const item = isNew ? null : list.data?.find((a) => a.id === Number(id));
  const back = () => router.replace('/autoreserve');

  return (
    <DetailRouteShell ready={isNew || !!item} title={tx('common.autoReserve')} onBack={back} afterTitle={<NodeBadge node={node} />}
      message={list.error ? list.error.message : list.data ? 'ルールが見つかりません' : tx('common.loading')}>
      <AutoAddEditor key={`${id}-${node ?? ''}`} item={item ?? null} pending={pending} node={node} back={back} />
    </DetailRouteShell>
  );
}
