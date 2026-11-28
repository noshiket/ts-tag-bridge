// チャプター送りと、隣の話数（元の Web 版の jumpNextChapter / jumpPrevChapter / goToAdjacentEpisode と同じ）
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { streamBase, type StreamRef } from './target';
import { groupDuplicateVideos } from '../library/albumDetail';
import type { Video } from '../library/types';

export interface Chapter {
  name: string;
  sec: number;
}

/** 字幕・実況を外から取り込んだ時に、元と一致した区間（取り込み元ごと） */
export interface SyncTrack {
  /** 取り込み元の名前（例: 局名） */
  name: string;
  /** audio_overlap=音声の比べだけ（500ms刻み）。ほかは音声＋映像（サンプル単位） */
  method?: string;
  /** 取り込めた範囲（秒）。切れ目は音が合わずに落ちた穴 */
  ranges: { start: number; end: number }[];
}

/** GET /api/streams/vdb/<id>/drops（チャプター・ドロップの位置・スクランブルの区間・取り込み区間） */
export interface StreamMarks {
  chapters: Chapter[];
  drops: number[];
  scramble: { start: number; end: number }[];
  /** 取り込み区間（取り込みが無ければ空か無い） */
  sync?: SyncTrack[];
}

export const marksApi = (c: ApiClient) => ({
  get: (target: StreamRef, node?: string | null) => c.get<StreamMarks>(nodePath(node, `${streamBase(target)}/drops`)),
});

/** 次へ: 今より先のチャプターへ。無ければ次の話数（頭から） */
export function nextChapterTarget(chapters: Chapter[], cur: number): number | 'nextEpisode' {
  const next = chapters.find((ch) => ch.sec > cur + 0.5);
  return next ? next.sec : 'nextEpisode';
}

/**
 * 前へ: 2 秒以内は「今のチャプターの頭」と見て、ひとつ前のチャプターへ。
 * 前が無ければこの話の頭へ、頭近くならさらに前の話数（続きから）へ
 */
export function prevChapterTarget(chapters: Chapter[], cur: number): number | 'prevEpisode' {
  const prev = [...chapters].reverse().find((ch) => ch.sec < cur - 2.0);
  if (prev) return prev.sec;
  return cur > 2.0 ? 0 : 'prevEpisode';
}

/** コメントの勢い（件数/分）。尺が無ければ件数そのもの（同じ話が何本かある時に選ぶのに使う） */
const momentum = (v: Pick<Video, 'comment_count' | 'duration_sec'>) => {
  const min = v.duration_sec ? v.duration_sec / 60 : 0;
  return min > 0 ? (v.comment_count || 0) / min : v.comment_count || 0;
};

/**
 * 隣の話数。シリーズの並び（設定順）で、同じ話（話数・話数名が同じ）は1つと数え、
 * その中からは勢いのいちばんある1本を選ぶ。端なら null
 */
export function adjacentEpisode(seriesVideos: Video[], currentId: number, direction: 1 | -1): Video | null {
  const groups = groupDuplicateVideos(seriesVideos);
  const idx = groups.findIndex((g) => g.some((v) => v.id === currentId));
  const target = groups[idx + direction];
  if (idx < 0 || !target) return null;
  return target.reduce((a, b) => (momentum(b) > momentum(a) ? b : a));
}
