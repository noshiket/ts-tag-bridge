// Web の保存先（元の Web 版の VideoCache と同じ置き方）。置き場所の扱いは web/webStorage、
// 本体の書き込みは web/writeVideoWeb、読み出しと鍵の付け替えは web/readVideoWeb
import type { LocalSaveMeta } from '@tstag/core';

import type { LocalBackend, LocalRecord } from './backend.types';
import { readVideoWeb, renameWeb } from './web/readVideoWeb';
import {
  CHUNK_STORE, META_KEY, STORE, chunkInfo, deleteRec, eachInStore, fetchBlob, getRec, opfs, opfsVcacheFiles, putRec, removeChunks, tx, type Rec,
} from './web/webStorage';
import { writeVideoWeb } from './web/writeVideoWeb';
import { tNow } from '../../ui/i18n/I18n';

export const backend: LocalBackend = {
  available: () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function' && typeof indexedDB !== 'undefined',

  async loadIndex() {
    const out: Record<string, LocalSaveMeta> = {};
    try {
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith(META_KEY)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || 'null'); if (m) out[k.slice(META_KEY.length)] = m; } catch { /* 壊れた分は飛ばす */ }
      }
    } catch { /* localStorage が使えない */ }
    return out;
  },

  writeVideo: writeVideoWeb,

  async listPartial() {
    // 前回の起動で書きかけのまま終わった保存（元と同じく、続きを取るための情報を記録に持たせてある）
    const out: { ck: string; meta: LocalSaveMeta; secondary: boolean; progress: number }[] = [];
    const rows = await eachInStore<[IDBValidKey, Rec][]>(STORE, [], (acc, k, v) => { acc.push([k, v as Rec]); return acc; });
    for (const [k, r] of rows) {
      if (r.complete !== false || !r.opfs || !r.resumeMeta) continue;
      const ck = String(k);
      const info = await chunkInfo(ck);
      if (!info.total) continue;
      out.push({ ck, meta: r.resumeMeta, secondary: r.resumeOpts?.audio === 'secondary', progress: r.totalSize ? info.total / r.totalSize : 0 });
    }
    return out;
  },

  async commit(ck, rec: LocalRecord, meta, assets, headers) {
    const cur = (await getRec(ck)) ?? {};
    const [poster, thumbnailTile] = await Promise.all([fetchBlob(assets.poster, headers), assets.tile ? fetchBlob(assets.tile, headers) : null]);
    await putRec(ck, {
      ...cur, complete: true, opfs: true, chunkCount: cur.chunkCount ?? 1, totalSize: rec.totalSize, mime: rec.mime,
      ...rec.sidecar, poster, thumbnailTile, cachedAt: rec.cachedAt, audio: rec.audio,
    });
    try { localStorage.setItem(META_KEY + ck, JSON.stringify({ ...meta, cachedAt: rec.cachedAt, audio: rec.audio })); } catch { /* 一覧に出ないだけ */ }
  },

  async updateSidecar(ck, sidecar) {
    const cur = await getRec(ck);
    if (!cur || cur.complete === false) throw new Error(tNow('system.backend.noSavedData'));
    await putRec(ck, { ...cur, ...sidecar });
  },

  async saveJson(ck, name, data) {
    const cur = await getRec(ck);
    if (cur && cur.complete !== false) await putRec(ck, { ...cur, extra: { ...cur.extra, [name]: data } });
  },

  async readJson(ck, name) { return (await getRec(ck))?.extra?.[name] ?? null; },

  read: readVideoWeb,

  async posterUri(ck) {
    const r = await getRec(ck);
    return r?.poster instanceof Blob ? URL.createObjectURL(r.poster) : null;
  },

  async rename(oldCk, newCk) {
    await renameWeb(oldCk, newCk);
    try {
      const m = localStorage.getItem(META_KEY + oldCk);
      if (m != null) { localStorage.setItem(META_KEY + newCk, m); localStorage.removeItem(META_KEY + oldCk); }
    } catch { /* 一覧に出ないだけ */ }
  },

  async remove(ck) {
    try { localStorage.removeItem(META_KEY + ck); } catch { /* 無い */ }
    const r = await getRec(ck);
    if (r && !r.opfs) {
      await tx<void>(CHUNK_STORE, 'readwrite', (s) => { for (let i = 0; i < (r.chunkCount || 0); i++) s.delete(`${ck}_${i}`); }).catch(() => {});
    }
    await deleteRec(ck);
    await removeChunks(ck);
  },

  async clear() {
    try { Object.keys(localStorage).forEach((k) => { if (k.startsWith(META_KEY)) localStorage.removeItem(k); }); } catch { /* 無い */ }
    await tx<void>(STORE, 'readwrite', (s) => { s.clear(); }).catch(() => {});
    await tx<void>(CHUNK_STORE, 'readwrite', (s) => { s.clear(); }).catch(() => {});
    const root = await opfs();
    if (!root) return;
    const names: string[] = [];
    for await (const [name] of opfsVcacheFiles()) names.push(name);
    for (const n of names) await root.removeEntry(n).catch(() => {});
  },

  async usage() {
    // Safari の storage.estimate は当てにならないので実際の大きさを足す（元と同じ）
    let total = 0;
    total += await eachInStore(STORE, 0, (t, _k, v) => t + Object.values((v as object) || {}).reduce<number>((a, x) => a + (x instanceof Blob ? x.size : 0), 0));
    total += await eachInStore(CHUNK_STORE, 0, (t, _k, v) => t + (v instanceof Blob ? v.size : 0));
    try {
      for await (const [, h] of opfsVcacheFiles()) if (h.kind === 'file') total += (await (h as FileSystemFileHandle).getFile()).size;
    } catch { /* 数えられない分は飛ばす */ }
    return total;
  },
};
