import { localKey, type LocalItem, type LocalSaveMeta, type Api as TSTagApi } from '@tstag/core';

import { backend } from './backend';
import type { LocalJsonName } from './backend.types';
import { fetchExtras } from './extras';
import { abortAll, dequeue, enqueue, rememberApi } from './downloadQueue';
import { getSnap, setActive, setSnap } from './snapshot';

// ローカル保存（元の helpers.jsx の VideoCache）の入口。状態は snapshot、1本ずつ取る待ち行列は downloadQueue、
// 画面から読むフックと絞り込みは localSaveHooks
export { tileReflowed } from './downloadQueue';
export { activeItems, localItems, localStateOf, shallowEq, useLocalSave, useLocalSaveSelect } from './localSaveHooks';
export { queuedLabel, type ActiveItem, type ActiveState } from './snapshot';

export const localSave = {
  available: () => backend.available(),
  /** 保存を積む（1本ずつ順に取る）。secondary: 副音声で保存する */
  download(api: TSTagApi, id: number, node: string | null, meta: LocalSaveMeta, secondary = false) {
    const ck = localKey(id, node);
    const cur = getSnap().states[ck];
    if (cur && cur.status !== 'error') return;
    rememberApi(api, true);
    // アプリが終わっても次の起動で取り直せるよう端末に控える（iOS）
    try { backend.remember?.(ck, { meta, secondary }); } catch { /* 控えられなくても保存は進める */ }
    enqueue(ck, { id, node, meta, secondary });
  },
  /** 保存中・待機中を取り消す（書きかけも消す）。保存済みは消さない */
  async cancel(id: number, node: string | null) {
    const ck = localKey(id, node);
    if (dequeue(ck)) return;
    setActive(ck, null);
    if (!getSnap().index[ck]) await backend.remove(ck).catch(() => {});
  },
  async remove(id: number, node: string | null) {
    const ck = localKey(id, node);
    await localSave.cancel(id, node);
    const index = { ...getSnap().index };
    delete index[ck];
    setSnap({ index });
    await backend.remove(ck);
  },
  async clear() {
    abortAll();
    setSnap({ index: {}, states: {} });
    await backend.clear();
  },
  usage: () => backend.usage(),
  /** 動画の番号・サーバーが変わった時に保存を付け替える（元の VideoCache.rename） */
  async rename(oldId: number, newId: number, node: string | null, newNode: string | null = node) {
    const from = localKey(oldId, node), to = localKey(newId, newNode);
    const s = getSnap();
    if (from === to || !s.index[from]) return;
    await backend.rename(from, to);
    const index = { ...getSnap().index, [to]: s.index[from]! };
    delete index[from];
    setSnap({ index });
  },
  /**
   * ファイルの置き場所を直した（relocate）結果に保存を合わせる。同じサーバーの中で番号が変わった時だけ付け替え、
   * 連携先へ移した時は移った先が分からないので残す（一覧を開いた時に放送から探し直す。元と同じ）
   */
  afterRelocate(res: { new_video_id?: number; pushed?: boolean } | null | undefined, oldId: number, node: string | null) {
    if (res?.new_video_id && !res.pushed) void localSave.rename(oldId, res.new_video_id, node).catch(() => {});
  },
  /**
   * 番号で引けなくなった保存分を、元の放送で探して張り替える（relocate やサーバー側の自動転送で番号が変わるため）。
   * 識別子や録画時刻を持たない古い保存は触らない（一挙放送の話数を取り違えるため。元と同じ）
   */
  async reconcile(api: TSTagApi, missing: LocalItem[], nodes: (string | null)[]) {
    for (const it of missing) {
      if (it.onid == null || it.sid == null || !it.eitStartTime || !it.recStart) continue;
      for (const n of nodes) {
        let found: number | null = null;
        try { found = await api.localSave.findByBroadcast(it as LocalSaveMeta, n); } catch { continue; }
        if (found == null) continue;
        if (found !== it.id || (n || null) !== (it.node || null)) await localSave.rename(it.id, found, it.node, n).catch(() => {});
        break;
      }
    }
  },
  /** 動画本体はそのままに、補助データ（番組情報・実況・ドロップ・字幕）だけ取り直す */
  async refreshSidecar(api: TSTagApi, id: number, node: string | null) {
    await backend.updateSidecar(localKey(id, node), await api.localSave.sidecar(id, node));
    await fetchExtras(api, localKey(id, node), id, node);
  },
  /** 保存に添えた JSON（card: カードの中身、tag: tag.json。無ければ null） */
  saveJson: (id: number, node: string | null, name: LocalJsonName, data: unknown) => backend.saveJson(localKey(id, node), name, data),
  readJson: (id: number, node: string | null, name: LocalJsonName) => backend.readJson(localKey(id, node), name),
  /** 保存済みか（一覧を読む前は false） */
  isSaved: (id: number, node: string | null) => !!getSnap().index[localKey(id, node)],
  read: (id: number, node: string | null) => backend.read(localKey(id, node)),
  posterUri: (id: number, node: string | null) => backend.posterUri(localKey(id, node)),
};
