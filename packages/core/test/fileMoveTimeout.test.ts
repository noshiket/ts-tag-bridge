import { describe, expect, it } from 'vitest';

import { FILE_MOVE_TIMEOUT_MS } from '../src/library/videoActions';
import { videoActionsApi } from '../src/library/videoActions';
import { libraryApi } from '../src/library/api';
import type { ApiClient } from '../src/http/client';

// ファイルを動かす操作は、ふつうの読み込み（8 秒）で打ち切らない（数 GB のコピーで数十秒かかる）
describe('ファイルを動かす操作の待ち時間', () => {
  const calls: { path: string; opts?: { timeoutMs?: number } }[] = [];
  const c = { post: (path: string, _b: unknown, opts?: { timeoutMs?: number }) => { calls.push({ path, opts }); return Promise.resolve({}); } } as unknown as ApiClient;
  it('置き場所・フォルダ名・シリーズ名の変更は長く待つ', async () => {
    await videoActionsApi(c).relocate(1);
    await libraryApi(c).renameFolder(2, 'x');
    await libraryApi(c).renameSeries(3, 'y');
    expect(calls.map((x) => x.opts?.timeoutMs)).toEqual([FILE_MOVE_TIMEOUT_MS, FILE_MOVE_TIMEOUT_MS, FILE_MOVE_TIMEOUT_MS]);
    expect(FILE_MOVE_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});
