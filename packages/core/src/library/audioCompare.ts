// 字幕・実況コメントの取り込み（元の encode.jsx の AudioCompareSheet）。同じ番組の別の放送と音声を比べ、
// 共通の区間の字幕・コメントをこの動画へ移す。解析はサーバーの仕事（同時に1本）で、番号で進み具合を見る
import type { ApiClient } from '../http/client';

/** 取り込み元の候補（動画か録画） */
export interface CompareCandidate {
  kind: 'video' | 'recording'; id: number; title?: string; path: string; station?: string; recording_start_time?: string;
  has_caption?: boolean; comment_count?: number; duration_sec?: number;
  /** 切り出した区間と実際の長さが合わない秒数（中身が足りない相手） */
  duration_gap?: number | null;
}
export interface SyncRange {
  a_start: number; a_end: number; b_start: number; b_end: number; offset: number; coarse_offset?: number;
  video_judged?: boolean; video_frame_offset?: number; a_start_tot?: string; b_start_tot?: string;
}
/** 取り込んだ時の時間の対応（tag.json の audio_sync） */
export interface SyncRecord {
  source?: { video_id?: number; station?: string; eit_start_time?: string; onid?: number; tsid?: number; sid?: number; eid?: number };
  ranges?: SyncRange[]; method?: 'audio_xcorr' | 'audio_overlap' | string; applied_at?: string; added?: Record<string, { count: number }>;
}
export interface AddedTracks { captions: { index: number; name: string; count: number }[]; comments: { key: string; count: number }[] }
export interface Added { captions?: { count: number; name: string }; comments?: { count: number; name: string }; skipped?: Record<string, string> }
export interface CompareJob {
  id: string; state: 'running' | 'queued' | 'done' | 'error' | string; kind?: string; log?: string[]; error?: string | null;
  result?: {
    added?: Added; matches?: { videoA: { start: string; end: string }; correlation?: number }[];
    ranges?: SyncRange[]; video?: ({ judged: boolean; ok: boolean; frame_offset: number } | null)[];
    source?: { announce?: string | null; announce_self?: string | null };
  };
}

const momentum = (c: CompareCandidate) => { const min = (c.duration_sec || 0) / 60; return min > 0 ? (c.comment_count || 0) / min : c.comment_count || 0; };

/** 始めに選ぶ相手: 中身の足りる相手のうち、字幕を持つものから勢い（コメント/分）がいちばん大きいもの */
export function pickDefaultCandidate(c: { videos?: CompareCandidate[]; recordings?: CompareCandidate[] } | null): CompareCandidate | null {
  const all = [...(c?.videos ?? []), ...(c?.recordings ?? [])];
  if (!all.length) return null;
  const sound = all.filter((x) => !x.duration_gap);
  const pool = sound.length ? sound : all;
  const withCap = pool.filter((x) => x.has_caption);
  return (withCap.length ? withCap : pool).reduce((a, b) => (momentum(b) > momentum(a) ? b : a));
}

/** 選んだ相手が字幕・コメントを持つか（パスを直に指定した時は分からないので両方あり） */
export const sourceHas = (sel: CompareCandidate | null) => ({ caption: !sel || !!sel.has_caption, comment: !sel || (sel.comment_count || 0) > 0 });

/** 同じ相手で前に解析した記録（その時間の対応を使えば解析の3分を省ける） */
export const reusableRecord = (records: SyncRecord[], sel: CompareCandidate | null) =>
  sel?.kind === 'video' ? records.filter((r) => r.source?.video_id === sel.id && (r.ranges ?? []).length).slice(-1)[0] ?? null : null;

const METHOD: Record<string, string> = { audio_xcorr: '音声＋映像（サンプル単位）', audio_overlap: '音声比較のみ（500ms刻み）' };
export const syncMethodLabel = (m?: string) => METHOD[m ?? ''] ?? METHOD.audio_xcorr!;

/** 取り込めたものの言い方 */
export function addedLabel(a: Added | undefined): string {
  const parts = [a?.captions && `字幕 ${a.captions.count}件(${a.captions.name})`, a?.comments && `コメント ${a.comments.count}件(${a.comments.name})`].filter(Boolean);
  return parts.join(' / ') + (a?.skipped ? `（${Object.values(a.skipped).join(' / ')}）` : '');
}

/** 'HH:MM:SS.sss' を秒に */
export const hmsToSec = (t: string) => { const p = String(t).split(':'); return Number(p[0]) * 3600 + Number(p[1]) * 60 + parseFloat(p[2] ?? '0'); };

export const audioCompareApi = (c: ApiClient) => ({
  candidates: (id: number) => c.get<{ videos?: CompareCandidate[]; recordings?: CompareCandidate[] }>(`/api/videos/${id}/audio-compare/candidates`),
  /** この動画で動いている解析（無ければ直近の1件） */
  current: (id: number) => c.get<{ job?: CompareJob | null }>(`/api/audio-compare/current?video_id=${id}`),
  job: (jobId: string) => c.get<CompareJob>(`/api/audio-compare/jobs/${jobId}`),
  /** 比較→ずれの測定→映像の確認→取り込み を一度に（3分ほど）。audio_only は音声比較だけ（40秒ほど） */
  startFull: (id: number, body: Record<string, unknown>) => c.post<{ job_id: string }>(`/api/videos/${id}/audio-compare/full`, body),
  /** 前の時間の対応で取り込む */
  apply: (id: number, body: Record<string, unknown>) => c.post<{ added?: Added }>(`/api/videos/${id}/audio-compare/apply`, body),
  syncRecords: async (id: number) => (await c.get<{ records?: SyncRecord[] }>(`/api/videos/${id}/audio-sync`)).records ?? [],
  addedTracks: (id: number) => c.get<AddedTracks>(`/api/videos/${id}/added-tracks`),
  deleteTrack: (id: number, body: { caption_index?: number; comment_key?: string }) => c.post<AddedTracks>(`/api/videos/${id}/added-tracks/delete`, body),
});
