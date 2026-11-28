import { File as FsFile, UploadTask, UploadType } from 'expo-file-system';
import { tNow } from '../../../ui/i18n/I18n';

/** 選んだ動画ファイル。Web はブラウザの File、iOS は端末の一時の写し（選んだ時に OS が作る） */
export type Picked = { name: string; web?: File; native?: FsFile };

/** 端末のファイルを送る。数 GB になるので本体をそのまま送る。iOS は OS の転送で送る（アプリが裏へ回っても続く） */
export async function uploadPicked(url: string, headers: Record<string, string>, f: Picked, onProgress: (p: number) => void) {
  if (f.web) return uploadFile(url, headers, f.web, onProgress);
  const task = new UploadTask(f.native!, url, {
    headers, uploadType: UploadType.BINARY_CONTENT,
    onProgress: (p) => { const all = Number(p.totalBytes); if (all > 0) onProgress(Number(p.bytesSent) / all); },
  });
  const r = await task.uploadAsync();
  let j: { file_path?: string; error?: string } = {};
  try { j = JSON.parse(r.body || '{}'); } catch { /* 読めない */ }
  if (r.status >= 200 && r.status < 300) return j as { file_path: string };
  throw new Error(j.error || `HTTP ${r.status}`);
}

/** Web: 進み具合は XHR で見る */
function uploadFile(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void) {
  return new Promise<{ file_path: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let j: { file_path?: string; error?: string } = {};
      try { j = JSON.parse(xhr.responseText || '{}'); } catch { /* 読めない */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(j as { file_path: string }); else reject(new Error(j.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(tNow('common.uploadFailed')));
    xhr.send(file);
  });
}

/** 動画ファイルを選ぶ。iOS は「ファイル」から（選んだ物の一時の写しが渡る。原本はそのまま）、Web はブラウザのファイル選択 */
export async function pickVideoFile(web: boolean): Promise<Picked | null> {
  if (!web) {
    const r = await FsFile.pickFileAsync({ mimeTypes: ['video/*', 'video/mp2t', 'video/x-matroska', 'public.movie'] });
    return r.canceled ? null : { name: r.result.name, native: r.result };
  }
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'video/*,.mp4,.m4v,.mkv,.ts';
    el.onchange = () => { const f = el.files?.[0]; resolve(f ? { name: f.name, web: f } : null); };
    el.click();
  });
}
