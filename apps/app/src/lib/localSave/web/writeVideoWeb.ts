import type { LocalBackend } from '../backend.types';
import { chunkInfo, chunkName, deleteRec, getRec, opfs, putRec, removeChunks } from './webStorage';
import { tNow } from '../../../ui/i18n/I18n';

const COMMIT_BYTES = 128 * 1024 * 1024;
const STALL_MS = 45_000;

/**
 * 動画本体を OPFS へ書く。前の書きかけ（通信が切れた時に確定させて残した分）があれば、その続きから取る（元と同じ）。
 * 128MB ごとに確定させて次のファイルへ。45秒届かなければ止まったとみなす。
 * 取り消しは書きかけも記録も消す。通信が切れた時は書けた分を残して partial を付けて投げる
 */
export const writeVideoWeb: LocalBackend['writeVideo'] = async (ck, url, headers, mime, onProgress, signal, keep) => {
  try { await navigator.storage.persist?.(); } catch { /* 永続化を断られても保存はする */ }
  const root = (await opfs())!;
  const prev = await getRec(ck);
  let { total: have, count } = prev && prev.complete === false && prev.opfs ? await chunkInfo(ck) : { total: 0, count: 0 };
  const h: Record<string, string> = { ...headers };
  if (have) { h.Range = `bytes=${have}-`; if (prev?.etag) h['If-Range'] = prev.etag; }
  const res = await fetch(url, { headers: h, signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  if (have && res.status !== 206) {
    // サーバーが続きを断った（ファイルが変わった等）。頭から取り直す
    await removeChunks(ck);
    have = 0; count = 0;
  }
  const etag = res.headers.get('ETag');
  const total = have + (Number(res.headers.get('Content-Length')) || 0);
  const resume = { resumeMeta: keep.meta, resumeOpts: keep.secondary ? { audio: 'secondary' } : null };
  // 書き始める前に記録する（途中で止められても書きかけと分かり、続きを取れるように。元と同じ）
  await putRec(ck, { complete: false, opfs: true, chunkCount: count || 1, totalSize: total, mime, etag, ...resume }).catch(() => {});
  const reader = res.body.getReader();
  let idx = count, received = have, since = 0;
  let w = await (await root.getFileHandle(chunkName(ck, idx), { create: true })).createWritable();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(tNow('system.writeVideoWeb.connectionStalled'))), STALL_MS); });
      let r: ReadableStreamReadResult<Uint8Array>;
      try { r = await Promise.race([reader.read(), stalled]); } finally { clearTimeout(timer); }
      if (r.done) break;
      await w.write(r.value as Uint8Array<ArrayBuffer>);
      received += r.value.length;
      since += r.value.length;
      onProgress(total ? received / total : 0);
      // 粗い間隔で確定させ、次のファイルへ移る（同じファイルを開き直すと書いた分まるごと写し直しになる）
      if (since > COMMIT_BYTES) {
        await w.close();
        since = 0;
        idx += 1;
        w = await (await root.getFileHandle(chunkName(ck, idx), { create: true })).createWritable();
      }
    }
    await w.close();
  } catch (e) {
    try { await reader.cancel(); } catch { /* 止まっている */ }
    if (signal.aborted) {
      // 取り消し: 書きかけも記録も消す
      try { await w.abort(); } catch { /* 閉じている */ }
      await removeChunks(ck);
      await deleteRec(ck);
      throw e;
    }
    // 通信が切れた: 書けた分を確定させて残し、後で続きを取る（確定できなければ直前の確定分まで）
    let kept = received - since;
    try { await w.close(); kept = received; } catch { try { await w.abort(); } catch { /* 閉じている */ } }
    if (kept > 0) {
      await putRec(ck, { complete: false, opfs: true, chunkCount: idx + 1, totalSize: total, mime, etag, ...resume }).catch(() => {});
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: total ? kept / total : 0 });
    }
    await removeChunks(ck);
    await deleteRec(ck);
    throw e;
  }
  await putRec(ck, { complete: false, opfs: true, chunkCount: idx + 1, totalSize: received, mime, etag }).catch(() => {});
  return { totalSize: received };
};
