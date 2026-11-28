// Web の保存先の置き場所。元の Web 版（helpers.jsx の VideoCache）と同じ置き方にして、同じアドレスで開けば
// 元で保存した分をそのまま読める（逆も同じ）:
//   動画本体 … OPFS の vcache_<鍵>_<番号>（128MB ごとに確定させて次のファイルへ）。古い IndexedDB のチャンクも読む
//   補助データ … IndexedDB vlib-cache / videos（自サーバーの鍵は数値のまま。IndexedDB は 123 と '123' を区別する）
//   一覧の情報 … localStorage の vcache_meta_<鍵>
import type { LocalSaveMeta, LocalSidecar } from '@tstag/core';

const DB = 'vlib-cache';
export const STORE = 'videos', CHUNK_STORE = 'chunks';
export const META_KEY = 'vcache_meta_';

/** IndexedDB の1件（本体の置き場所・続きを取るための情報・補助データ） */
export type Rec = Partial<LocalSidecar> & {
  etag?: string | null; resumeMeta?: LocalSaveMeta | null; resumeOpts?: { audio?: string } | null;
  complete?: boolean; opfs?: boolean; chunkCount?: number; totalSize?: number; mime?: string;
  poster?: Blob | null; thumbnailTile?: Blob | null; cachedAt?: string; audio?: string; video?: Blob | null; extra?: Record<string, unknown>;
};

export const idbKey = (ck: string): IDBValidKey => (ck.includes('~') ? ck : Number(ck));
export const chunkName = (ck: string, i: number) => `vcache_${ck}_${i}`;

let dbp: Promise<IDBDatabase> | null = null;
export function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE);
    };
    r.onsuccess = () => { r.result.onclose = () => { dbp = null; }; res(r.result); };
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
export function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return openDb().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res((rq ? rq.result : undefined) as T);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error ?? new DOMException('aborted', 'AbortError'));
  }));
}
/** 1つの置き場を頭から順に読む（読めなくなったら、そこまで） */
export function eachInStore<A>(store: string, init: A, step: (acc: A, key: IDBValidKey, value: unknown) => A): Promise<A> {
  return openDb().then((db) => new Promise<A>((res) => {
    let acc = init;
    const cur = db.transaction(store, 'readonly').objectStore(store).openCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c) { res(acc); return; } acc = step(acc, c.key, c.value); c.continue(); };
    cur.onerror = () => res(acc);
  })).catch(() => init);
}
export const getRec = (ck: string) => tx<Rec | undefined>(STORE, 'readonly', (s) => s.get(idbKey(ck))).catch(() => undefined);
export const putRec = (ck: string, r: Rec) => tx<void>(STORE, 'readwrite', (s) => { s.put(r, idbKey(ck)); });
export const deleteRec = (ck: string) => tx<void>(STORE, 'readwrite', (s) => { s.delete(idbKey(ck)); }).catch(() => {});

export const opfs = () => navigator.storage?.getDirectory?.();
export async function chunkFile(ck: string, i: number): Promise<File | null> {
  try { return await (await (await opfs()!).getFileHandle(chunkName(ck, i))).getFile(); } catch { return null; }
}
/** 確定済みの書きかけ: 続いている分の大きさと本数 */
export async function chunkInfo(ck: string) {
  let total = 0, count = 0;
  for (;;) {
    const f = await chunkFile(ck, count);
    if (!f || !f.size) break;
    total += f.size;
    count += 1;
  }
  return { total, count };
}
export async function removeChunks(ck: string) {
  const root = await opfs();
  if (!root) return;
  for (let i = 0; ; i++) {
    try { await root.removeEntry(chunkName(ck, i)); } catch { if (i > 0) break; }
    if (i > 10_000) break;
  }
  try { await root.removeEntry(`vcache_${ck}`); } catch { /* 古い1本の形 */ }
}
/** OPFS の vcache_ のファイルを1つずつ（消す・数えるため） */
export async function* opfsVcacheFiles(): AsyncGenerator<[string, FileSystemHandle]> {
  const root = await opfs();
  if (!root) return;
  for await (const [name, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) if (name.startsWith('vcache_')) yield [name, h];
}

export async function fetchBlob(url: string, headers: Record<string, string>) {
  try { const r = await fetch(url, { headers }); return r.ok ? await r.blob() : null; } catch { return null; }
}
