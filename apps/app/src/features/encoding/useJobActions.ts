import type { EncodeRow } from '@tstag/core';
import { queryKeys, useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { errText, wait } from './jobShared';
import { useT } from '../../ui/i18n/I18n';

/**
 * エンコード進捗の「…」の操作（make_DB だけ・エンコードを飛ばす・削除）と、その結果の一言（上端に出す）。
 * refresh はエンコードの一覧を取り直す（詳細・やり直しからも使う）
 */
export function useJobActions(e: EncodeRow, node: string | null) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.encodes(node) });
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState('');
  const run = (label: string, f: () => Promise<unknown>, done: string, after?: () => void) => {
    setMoreOpen(false);
    setMsg(label);
    f().then(() => refresh()).then(() => { setMsg(done); after?.(); }).catch((err: unknown) => setMsg(tx('common.failed', { v0: errText(err) })));
  };
  return {
    refresh, moreOpen, setMoreOpen, confirmDel, setConfirmDel, msg,
    makeDbOnly: () => run(tx('encoding.useJobActions.runningMake'), async () => { await api.encodes.retry(e.id, 'make_DB', 'make_DB', node); await wait(3000); }, tx('encoding.useJobActions.makeDone')),
    skip: () => run(tx('encoding.useJobActions.skipping'), () => api.encodes.skip(e.recordingId!, node), tx('encoding.useJobActions.skipped')),
    del: () => { setConfirmDel(false); run(tx('common.deleting'), () => api.encodes.remove(e.id, node), tx('encoding.useJobActions.deleted'), () => router.replace('/recresult')); },
  };
}

export type JobActions = ReturnType<typeof useJobActions>;
