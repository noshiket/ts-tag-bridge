import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { encodeRowFromAddon, encodeRowFromJob, type EncodeRow } from './list';
import type { AddonJob, EncodeJob } from './types';

export const encodesApi = (c: ApiClient) => ({
  /** 録画のエンコードとアドオンの仕事を1つの並びにして返す（アドオンの仕事が読めなくても録画の分は出す） */
  list: async (node?: string | null): Promise<EncodeRow[]> => {
    const [jobs, addons] = await Promise.all([
      c.get<EncodeJob[]>(nodePath(node, '/api/encode/recordings')),
      c.get<AddonJob[]>(nodePath(node, '/api/encode/addon_jobs')).catch(() => [] as AddonJob[]),
    ]);
    return [...jobs.map(encodeRowFromJob), ...addons.map(encodeRowFromAddon)];
  },
  /** エンコード全体の停止（実行中の1本は最後までやり、次を始めない） */
  pause: (node?: string | null) => c.get<{ paused: boolean; hidden_running?: number; hidden_queued?: number }>(nodePath(node, '/api/encode/pause')),
  setPause: (paused: boolean, node?: string | null) => c.post<{ paused: boolean }>(nodePath(node, '/api/encode/pause'), { paused }),
  /** エンコーダーのログ（実行中の分） */
  console: async (id: number, node?: string | null) =>
    (await c.get<{ lines?: string[] }>(nodePath(node, `/api/encode/encodings/${id}/console`))).lines ?? [],
  /** 工程 state からやり直す（stopAfter の工程で止める） */
  retry: (id: number, state: string, stopAfter: string | null, node?: string | null) =>
    c.post(nodePath(node, `/api/encode/encodings/${id}/retry`), stopAfter ? { state, stop_after: stopAfter } : { state }),
  /** 録画のエンコードを飛ばす */
  skip: (recordingId: number, node?: string | null) => c.post(nodePath(node, `/api/encode/recordings/${recordingId}/skip_encode`)),
  /** エンコードを DB から消す（録画は残す。エンコード中なら Amatsukaze の仕事も止めて消す） */
  remove: (id: number, node?: string | null) => c.delete(nodePath(node, `/api/encode/encodings/${id}`)),
  /** 出力先・優先度の変更 */
  update: (id: number, fields: { encode_dir?: string; priority?: number }, node?: string | null) =>
    c.patch(nodePath(node, `/api/encode/encodings/${id}`), fields),
  /** サムネ: アドオンの仕事は対象の動画、終わったものはエンコード結果、他は録画の絵 */
  thumbnailUrl: (e: EncodeRow, node?: string | null): string | null =>
    e.isAddon && e.videoId != null ? c.url(nodePath(node, `/api/videos/${e.videoId}/thumbnail`))
      : e.state === 'encode_end' ? c.url(nodePath(node, `/api/encode/encodings/${e.id}/thumbnail`))
        : e.recordingId ? c.url(nodePath(node, `/api/encode/recordings/${e.recordingId}/thumbnail?t=5`)) : null,
});
