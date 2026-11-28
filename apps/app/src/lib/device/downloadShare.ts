// iOS で「端末へ保存」する: 一時の置き場へ落としてから共有シートで渡す（「ファイルに保存」「写真に保存」などを選べる）。
// Web のダウンロード（<a download>）の代わり。落とした一時ファイルは、次に落とす時とアプリを開いた時に前の分を消す
// （共有シートは閉じたことを知らせないので、その場では消せない。以前は同じ名前の時に上書きするだけで、
// 動画を保存するたびに数 GB ずつ溜まり、設定の使用量にも出ず、全削除でも消えなかった）
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { tNow } from '../../ui/i18n/I18n';

const dir = () => new Directory(Paths.cache, 'share');
// ファイル名に使えない文字を除く
const safe = (name: string) => name.replace(/[/\\:*?"<>|\n\r]/g, '_').slice(0, 180) || 'download';

/** 落とす。失敗したらエラーの文、できたらファイル */
async function fetchFile(url: string, headers: Record<string, string>, name: string): Promise<File | string> {
  clearShareCache();           // 前に渡した分（共有シートは1つずつなので、もう渡し終わっている）
  const d = dir();
  d.create({ intermediates: true, idempotent: true });
  const f = new File(d, safe(name));
  try {
    await new DownloadTask(url, f, { headers }).downloadAsync();
  } catch (e) {
    return e instanceof Error ? e.message : tNow('system.downloadShare.couldntDownload');
  }
  if (!f.exists) return tNow('system.downloadShare.couldntDownload');
  // 失敗の時はサーバーがエラーの JSON を返す。それを保存させない（元と同じ）
  if ((f.size ?? 0) < 4096) {
    try {
      const j = JSON.parse(f.textSync()) as { error?: string };
      if (j && typeof j === 'object' && 'error' in j) { f.delete(); return j.error || tNow('system.downloadShare.couldntDownload'); }
    } catch { /* JSON でなければ中身として扱う */ }
  }
  return f;
}

/** 落として共有シートを出す。失敗したらエラーの文、できたら null */
export async function downloadAndShare(url: string, headers: Record<string, string>, name: string): Promise<string | null> {
  const f = await fetchFile(url, headers, name);
  if (typeof f === 'string') return f;
  // 共有シートは iOS の部品だけ。部品が無い時（Web）は部品が無い時と同じ結果を返す（呼び出し側は Web でここに通らない）
  return tNow('system.downloadShare.appCantSaveFiles');
}

/** 画像を落としてクリップボードへ。失敗したらエラーの文、できたら null */
export async function downloadAndCopyImage(url: string, headers: Record<string, string>, name: string): Promise<string | null> {
  const f = await fetchFile(url, headers, name);
  if (typeof f === 'string') return f;
  // クリップボードへ写すのは iOS の部品だけ。部品が無い時（Web）は部品が無い時と同じ結果を返す（呼び出し側は Web でここに通らない）
  try { f.delete(); } catch { /* 消せなければ次の時に */ }
  return tNow('library.capture.copyFailed');
}

/** 保存用の一時ファイルの大きさ（バイト）。Web は使わないので 0 */
export function shareCacheUsage(): number {
  if (Platform.OS === 'web') return 0;
  try { const d = dir(); return d.exists ? Number(d.size ?? 0) : 0; } catch { return 0; }
}

/** 保存用の一時ファイルを消す */
export function clearShareCache(): void {
  if (Platform.OS === 'web') return;
  try { const d = dir(); if (d.exists) d.delete(); } catch { /* 消せなければ次の時に */ }
}
