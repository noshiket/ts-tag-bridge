import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { streamBase, type StreamRef } from './target';

/** 実況コメント1件（GET /api/streams/vdb/<id>/comments） */
export interface Comment {
  /** 動画の頭からの秒 */
  time: number;
  text: string;
  color: string;
  /** 流し方（right=右から流れる・top/bottom=固定） */
  type: string;
  author: string;
  date: string;
}

/**
 * コメントの答え（GET .../comments）。comments が主のトラック、tracks が外から取り込んだ追加のトラック
 * （名前 → 一覧。取り込みが無ければ無い）。元の Web 版の commentPayload と同じ形
 */
export interface CommentPayload {
  comments: Comment[];
  tracks?: Record<string, Comment[]>;
}

/** 全てのトラック（主＋追加）をまとめて流す選び方。既定（元の Web 版と同じ） */
export const ALL_COMMENT_TRACKS = '*';
/** 主のトラックの名前 */
export const MAIN_COMMENT_TRACK = 'comments';

/** 答えを CommentPayload にそろえる（古い保存はコメントの配列そのもの） */
export function normalizeCommentPayload(raw: unknown): CommentPayload {
  if (Array.isArray(raw)) return { comments: raw as Comment[] };
  if (!raw || typeof raw !== 'object') return { comments: [] };
  const r = raw as { comments?: unknown; tracks?: unknown };
  const out: CommentPayload = { comments: Array.isArray(r.comments) ? (r.comments as Comment[]) : [] };
  if (r.tracks && typeof r.tracks === 'object') {
    const tracks = Object.fromEntries(Object.entries(r.tracks as Record<string, unknown>)
      .filter((e): e is [string, Comment[]] => Array.isArray(e[1])));
    if (Object.keys(tracks).length) out.tracks = tracks;
  }
  return out;
}

/** 切り替えの候補（全て・標準・追加のトラック）。追加のトラックが無ければ null（切り替えを出さない） */
export function commentTrackNames(p: CommentPayload): string[] | null {
  const extra = Object.keys(p.tracks ?? {});
  return extra.length ? [ALL_COMMENT_TRACKS, MAIN_COMMENT_TRACK, ...extra] : null;
}

/** 切り替えの表示名（元と同じ: '*'＝全て、'comments'＝標準、ほかはトラック名） */
export const commentTrackLabel = (t: string) => (t === ALL_COMMENT_TRACKS ? '全て' : t === MAIN_COMMENT_TRACK ? '標準' : t);

/** 選んだトラックのコメント。全ては主＋追加を時刻順にまとめる。知らない名前なら主のトラック（元と同じ） */
export function selectCommentTrack(p: CommentPayload, track: string): Comment[] {
  const main = p.comments ?? [];
  const tracks = p.tracks ?? {};
  if (track === ALL_COMMENT_TRACKS) {
    if (!Object.keys(tracks).length) return main;
    return [main, ...Object.values(tracks)].flat().sort((a, b) => (a.time || 0) - (b.time || 0));
  }
  return Array.isArray(tracks[track]) ? tracks[track]! : main;
}

export const commentsApi = (c: ApiClient) => ({
  /** 主のトラックと、取り込んだ追加のトラック */
  payload: async (target: StreamRef, node?: string | null) =>
    normalizeCommentPayload(await c.get<unknown>(nodePath(node, `${streamBase(target)}/comments`))),
});

/**
 * 再生位置以下の最後のコメント（時刻の順に並んでいる前提）。無ければ -1。
 * 再生中は1秒に何度も呼ぶので、頭から数えず二分探索で探す（元の Web 版と同じ）
 */
export function activeCommentIndex(comments: { time: number }[], t: number): number {
  let lo = 0;
  let hi = comments.length - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (comments[mid]!.time <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}
