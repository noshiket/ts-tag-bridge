import { listQueries, useApi, useNodes } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { serverCycle, useViewNode } from '../../lib/state/viewNode';
import { useTheme } from '../../ui/theme/Tweaks';
import { useRecResultState } from '../recresult/state';

/** 今の画面が落ち着いてから取る（画面の読み込みと取り合わない） */
const DELAY_MS = 2000;

/**
 * サーバー切り替えの次のサーバーの一覧を、裏で先に取っておく。切り替えた時に取り始めると、
 * 連携先の一覧が届くまで画面が空のままだった。先に取っておけば、切り替えた時はそれをすぐ出し、
 * 古ければ出したまま取り直す。取るのは一度だけで、ずっと取り直し続けはしない（画面が開いていないので）
 */
export function usePrefetchOtherServer() {
  const api = useApi();
  const qc = useQueryClient();
  const path = usePathname();
  const peers = useNodes().data?.nodes ?? [];
  const { viewNode } = useViewNode();
  const { pageSize } = useTheme();
  const [rec] = useRecResultState();
  const next = peers.length ? serverCycle(peers, viewNode).next : undefined;
  const recKey = JSON.stringify([rec.filters, rec.page, pageSize]);

  useEffect(() => {
    if (next === undefined) return;
    const t = setTimeout(() => {
      const q = listQueries;
      // 下のタブの数（予約・録画結果）はどの画面でも出る
      const opts: { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }[] = [q.reserves(api, next), q.encodes(api, next)];
      if (path === '/') opts.push(q.albums(api, next));
      if (path === '/recresult') opts.push(q.recordings(api, rec.filters, rec.page, pageSize, next));
      if (path === '/reservations') opts.push(q.tunerReserves(api, next));
      if (path === '/epg' || path === '/search') opts.push(q.services(api, next));
      if (path === '/autoreserve') opts.push(q.autoAdd(api, next), q.manuAdd(api, next));
      // 取れなくても切り替えた時に取り直すだけなので、失敗は気にしない（prefetchQuery は投げない）
      for (const o of opts) void qc.prefetchQuery(o);
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [api, qc, path, next, recKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
