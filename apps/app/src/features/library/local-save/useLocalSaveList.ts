import type { Video } from '@tstag/core';
import { useApi, useNodes } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { activeItems, localItems, localSave, useLocalSaveSelect } from '../../../lib/localSave/store';
import { usePrivateMode } from '../../../lib/state/privateMode';

export type LocalCard = Video & { series_name?: string | null; album_name?: string | null };
/** サーバーは ids を 200 件で切るので分けて聞く（元と同じ） */
const CHUNK = 200;
async function inChunks<T>(ids: number[], f: (part: number[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await f(ids.slice(i, i + CHUNK)));
  return out;
}

/** 保存中の並びと状態（待機・保存中・失敗）だけを比べる（進み具合は保存中の行が自分で読む） */
const statusSig = (s: { states: Record<string, { status: string }> }) => Object.entries(s.states).map(([k, v]) => `${k}:${v.status}`).join(',');
const sameExceptProgress = <S extends { ready: boolean; index: unknown; states: Record<string, { status: string }> }>(a: S, b: S) =>
  a.ready === b.ready && a.index === b.index && statusSig(a) === statusSig(b);

/**
 * ローカル保存の一覧の中身: 保存中と保存済み（そのサーバーの分）、保存済みのカード、非公開で隠す分。
 * 一覧は保存中の並びと状態が変わった時だけ描き直す（進み具合のたびに丸ごと描き直すと、裏で再生している時に操作が効かなくなった）。
 * カードが返らず隠してもいない保存分は、番号が変わった（移った）ものかもしれないので放送から探して張り替える
 */
export function useLocalSaveList(node: string | null) {
  const api = useApi();
  const [privMode] = usePrivateMode();
  const snap = useLocalSaveSelect((s) => s, sameExceptProgress);
  const active = activeItems(snap, node);
  const activeIds = new Set(active.map((a) => a.id));
  const saved = localItems(snap, node).filter((it) => !activeIds.has(it.id));
  const ids = saved.map((it) => it.id);
  const idsKey = ids.join(',');
  const cards = useQuery({
    queryKey: ['library', node ?? '', 'localCards', idsKey, privMode],
    queryFn: async () => Object.fromEntries((await inChunks(ids, (p) => api.library.videoCards(p, node))).map((c) => [c.id, c as LocalCard])),
    enabled: ids.length > 0, retry: false,
  });
  const hidden = useQuery({
    queryKey: ['library', node ?? '', 'localHidden', idsKey, privMode],
    queryFn: async () => new Set(await inChunks(ids, (p) => api.library.privateHidden(p, node))),
    enabled: ids.length > 0, retry: false,
  });
  // カードの中身は保存に添えてある（保存した時・ここで受け取った時に書く）。通信が無い時はそれで同じカードを出す
  useEffect(() => {
    if (cards.data) for (const id of ids) if (cards.data[id]) void localSave.saveJson(id, node, 'card', cards.data[id]).catch(() => {});
  }, [cards.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const offline = cards.isError;
  const kept = useQuery({
    queryKey: ['library', node ?? '', 'localSavedCards', idsKey],
    queryFn: async () => Object.fromEntries((await Promise.all(ids.map(async (id) => [id, await localSave.readJson(id, node, 'card')] as const)))
      .filter(([, c]) => c).map(([id, c]) => [id, c as LocalCard])),
    enabled: offline && ids.length > 0,
  });
  // 探す先は今のサーバー → 自サーバー → 他のサーバー（連携先へ移った分を拾う。元と同じ）
  const nodes = useNodes();
  useEffect(() => {
    if (!cards.data || !hidden.data) return;
    const missing = saved.filter((it) => !cards.data[it.id] && !hidden.data.has(it.id));
    if (!missing.length) return;
    const where = [node, null, ...(nodes.data?.nodes ?? []).map((n) => n.name)].filter((n, i, a) => a.indexOf(n) === i);
    void localSave.reconcile(api, missing, where);
  }, [cards.data, hidden.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ready: snap.ready, active, saved, byId: cards.data ?? kept.data, hidden: hidden.data, offline };
}
