import type { LocalBundle } from '../backend.types';
import { CHUNK_STORE, chunkFile, chunkName, deleteRec, getRec, opfs, putRec, tx } from './webStorage';

/**
 * 保存済みの動画を読む。本体は OPFS のチャンク（古い1本の形も）か、古い IndexedDB のチャンク、もっと古い1本の Blob。
 * 書きかけ・欠けがあれば null。開いた URL は release で返す
 */
export async function readVideoWeb(ck: string): Promise<LocalBundle | null> {
  const r = await getRec(ck);
  if (!r || r.complete === false) return null;
  const mime = r.mime || 'video/mp4';
  let video: Blob | null = null;
  if (r.video instanceof Blob) video = r.video;   // 古い形（1本の Blob）
  else if (r.opfs) {
    const parts: File[] = [];
    const n = r.chunkCount || 0;
    if (!n) { const f = await (async () => { try { return await (await (await opfs()!).getFileHandle(`vcache_${ck}`)).getFile(); } catch { return null; } })(); if (f) parts.push(f); }
    for (let i = 0; i < n; i++) { const f = await chunkFile(ck, i); if (!f) return null; parts.push(f); }
    if (!parts.length) return null;
    video = new Blob(parts, { type: mime });
  } else {
    const blobs: Blob[] = [];
    for (let i = 0; i < (r.chunkCount || 0); i++) {
      const b = await tx<Blob | undefined>(CHUNK_STORE, 'readonly', (s) => s.get(`${ck}_${i}`)).catch(() => undefined);
      if (!b) return null;
      blobs.push(b);
    }
    video = new Blob(blobs, { type: mime });
  }
  const urls: string[] = [];
  const mk = (b: Blob | null | undefined) => { if (!(b instanceof Blob)) return null; const u = URL.createObjectURL(b); urls.push(u); return u; };
  return {
    videoUri: mk(video)!, posterUri: mk(r.poster), tileUri: mk(r.thumbnailTile), mime,
    sidecar: { metadata: r.metadata ?? null, comments: r.comments ?? { comments: [] }, drops: r.drops ?? null, captions: r.captions ?? {} },
    release: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

/** 鍵を変える（自サーバーの鍵 ⇄ 他サーバーの鍵）。OPFS は名前を変えられない所があるので、写してから消す（元と同じ） */
export async function renameWeb(oldCk: string, newCk: string) {
  const r = await getRec(oldCk);
  if (!r) return;
  await putRec(newCk, r);
  await deleteRec(oldCk);
  if (r.opfs) {
    const root = (await opfs())!;
    for (let i = 0; i < (r.chunkCount || 0); i++) {
      const f = await chunkFile(oldCk, i);
      if (!f) continue;
      const w = await (await root.getFileHandle(chunkName(newCk, i), { create: true })).createWritable();
      await w.write(f);
      await w.close();
      await root.removeEntry(chunkName(oldCk, i)).catch(() => {});
    }
  } else {
    for (let i = 0; i < (r.chunkCount || 0); i++) {
      const b = await tx<Blob | undefined>(CHUNK_STORE, 'readonly', (s) => s.get(`${oldCk}_${i}`)).catch(() => undefined);
      if (b) await tx<void>(CHUNK_STORE, 'readwrite', (s) => { s.put(b, `${newCk}_${i}`); s.delete(`${oldCk}_${i}`); }).catch(() => {});
    }
  }
}
