// エンコードのキューと履歴（元の Web 版の api.jsx の _adaptEncodeJob / queue.jsx と同じ決め方）
import type { AddonJob, EncodeJob, TrimSegment } from './types';

export type EncodeStatus = 'queued' | 'running' | 'done' | 'error';

/** 工程の順 */
const ORDER = ['wait_encode', 'make_DB', 'split_ts', 'encoding', 'encoded_analyze', 'file_copy', 'delete', 'encode_end'];

/** エンコードの工程の名前（画面の札） */
export const ENCODE_STATE_LABELS: Record<string, string> = {
  wait_encode: '待機', make_DB: 'DB登録', split_ts: 'TS分割', encoding: 'エンコード', encoded_analyze: '解析',
  file_copy: 'コピー', delete: '片付け', encode_end: '完了', encode_error: '失敗',
};

/** 状態（失敗の知らせがあればエラー） */
export function encodeStatus(state: string, errorMessage?: string | null): EncodeStatus {
  if (errorMessage) return 'error';
  if (state === 'encoding' || state === 'encoded_analyze' || state === 'file_copy') return 'running';
  if (state === 'encode_end') return 'done';
  return 'queued';
}

/** 進み具合（0〜1）。エンコード中は Amatsukaze の値、その前は 0、終わっていれば 1 */
export function encodeProgress(state: string, raw: number): number {
  if (state === 'encode_end') return 1;
  if (state === 'encoding') return Math.min(raw || 0, 1);
  return ORDER.indexOf(state) < ORDER.indexOf('encoding') ? 0 : raw || 0;
}

/** 画面に出す1行（録画のエンコードとアドオンの仕事を同じ並びに混ぜる。元と同じ） */
export interface EncodeRow {
  id: number;
  isAddon: boolean;
  recordingId: number | null;
  videoId: number | null;
  title: string;
  episodeNumber: string;
  sid: number | null;
  state: string;
  status: EncodeStatus;
  progress: number;
  priority: number;
  errorMessage: string;
  /** エンコードの設定（アドオンはアドオンの名前） */
  preset: string;
  encodeDir: string;
  folder: string;
  episodeName: string;
  onid: number | null;
  /** どの工程で失敗したか */
  failedState: string | null;
  addonStep: string | null;
  outputPath: string;
  trimSegments: TrimSegment[];
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  /** エンコードを始めた時刻（時差付き ISO。無ければ空） */
  encodingStartedAt: string;
}

function parseTrim(v: EncodeJob['trim_segments']): TrimSegment[] {
  if (!v) return [];
  try {
    const a: unknown = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? (a as TrimSegment[]) : [];
  } catch {
    return [];
  }
}

export const encodeRowFromJob = (r: EncodeJob): EncodeRow => ({
  id: r.id, isAddon: false, recordingId: r.recording_id, videoId: r.video_id, title: r.title || '',
  episodeNumber: r.episode_number ?? '', sid: r.sid, state: r.state, status: encodeStatus(r.state, r.error_message),
  progress: encodeProgress(r.state, r.progress), priority: r.priority ?? 3, errorMessage: r.error_message || '',
  preset: r.category || '', encodeDir: r.encode_dir || '', folder: r.folder || '', episodeName: r.episode_name || '',
  onid: r.onid ?? null, failedState: r.failed_state || null, addonStep: r.addon_step || null, outputPath: r.app_output_path || '',
  trimSegments: parseTrim(r.trim_segments), startedAt: r.analyzed_recording_start_time || r.recording_start_time || '',
  finishedAt: r.analyzed_recording_end_time || r.recording_end_time || '', updatedAt: r.updated_at || '',
  encodingStartedAt: r.encoding_started_at || '',
});

export const encodeRowFromAddon = (j: AddonJob): EncodeRow => ({
  id: j.encId, isAddon: true, recordingId: null, videoId: j.videoId, title: j.title || `video ${j.videoId}`,
  episodeNumber: '', sid: null, state: j.state, status: encodeStatus(j.state, j.errorMessage),
  progress: j.progress || 0, priority: j.priority ?? 3, errorMessage: j.errorMessage || '',
  preset: j.addon || '', encodeDir: '', folder: j.folder || '', episodeName: '', onid: null, failedState: null, addonStep: null,
  outputPath: '', trimSegments: [], startedAt: '', finishedAt: '', updatedAt: j.updatedAt || '', encodingStartedAt: '',
});

/**
 * 実行中の 1 本の残り時間（秒）。その 1 本が始まってからの進み方で計る（局・解像度・音声の違いを含む実測）。
 * 始めの 2 分か 3% まではぶれるので出さない（null）。始めた時刻が無い行も null
 */
export function encodeRemainingSec(e: Pick<EncodeRow, 'state' | 'progress' | 'encodingStartedAt'>, nowMs: number): number | null {
  if (e.state !== 'encoding' || !e.encodingStartedAt) return null;
  const elapsed = (nowMs - Date.parse(e.encodingStartedAt)) / 1000;
  if (!(elapsed >= 120) || !(e.progress >= 0.03) || e.progress >= 1) return null;
  return Math.round((elapsed * (1 - e.progress)) / e.progress);
}

/** キューの並び: 実行中 → 待機（優先度の高い順 → 番号の小さい順＝実際に始まる順） → エラー */
export function encodeQueueSort(rows: EncodeRow[]): EncodeRow[] {
  const order: Record<string, number> = { running: 0, queued: 1, error: 2 };
  return [...rows].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.priority - a.priority || a.id - b.id);
}

/** キュー（待機・実行中）と履歴（終わったもの。エラーを先に、後は新しい順） */
export function splitEncodes(rows: EncodeRow[]) {
  const queue = encodeQueueSort(rows.filter((e) => e.status === 'queued' || e.status === 'running'));
  const history = rows.filter((e) => e.status === 'done' || e.status === 'error').sort((a, b) =>
    (a.status === 'error' ? 0 : 1) - (b.status === 'error' ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt));
  return {
    queue, history,
    running: queue.filter((e) => e.status === 'running').length,
    waiting: queue.filter((e) => e.status === 'queued').length,
    done: rows.filter((e) => e.status === 'done').length,
    errors: rows.filter((e) => e.status === 'error').length,
  };
}

/** やり直せる工程（実行順） */
export const RETRY_STATES = ['split_ts', 'encoding', 'encoded_analyze', 'file_copy'];

/**
 * 選べるやり直しの工程: 失敗した工程より先は選べない（その工程が作るはずのものが無い・壊れたまま進んでしまう。
 * 例: encoded_analyze で不正とされた出力を file_copy からやり直すとライブラリへ入ってしまう）。元と同じ
 */
export function retryStatesFor(failedState: string | null): string[] {
  const i = failedState ? RETRY_STATES.indexOf(failedState) : -1;
  return i >= 0 ? RETRY_STATES.slice(0, i + 1) : RETRY_STATES;
}
