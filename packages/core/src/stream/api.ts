import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import { parseAudioViz } from './audioviz';
import { streamBase, type StreamRef } from './target';
import type { WatchMeta } from '../watch/api';
import type { ThumbnailTile } from './thumbnailTile';

/** GET /api/streams/vdb/<id>/metadata（再生画面に出す番組情報と、位置の計算に使う値） */
export interface StreamMeta extends WatchMeta {
  title: string;
  description: string;
  extended_info: string;
  genre: string;
  station_name: string;
  end_time: string | null;
  duration: number;
  episode_number: string | null;
  episode_name: string | null;
  series_id: number | null;
  series_name: string | null;
  album_id: number | null;
  /** 放送異常告知（テロップ等。動画だけ）。'none' 始まり=なし、空=分からない */
  announce?: string;
  media_kind: 'video' | 'audio';
  has_secondary_audio: boolean;
  has_caption: boolean;
  comment_count: number;
  /** false: サーバーで HLS にできない（AV1 など）。ファイルをそのまま再生する */
  streamable: boolean;
  /** 映像のコーデック（h264・hevc・av1 など） */
  video_codec?: string;
  container_format: string;
  /** シークバーのサムネ（一定間隔のコマを1枚に並べた画像）があるか */
  has_thumbnail_tile: boolean;
  thumbnail_info: { tile?: ThumbnailTile } | null;
  // ── 音楽だけ（曲情報タブ） ──
  artist?: string | null;
  /** 原本から取り込んだ埋め込み情報（曲名・アルバム・歌詞など） */
  media_tags?: Record<string, string> | null;
  /** 原本の音声の形式 */
  source_audio?: { codec?: string; sample_rate?: number; bits_per_sample?: number; channels?: number; bit_rate?: number } | null;
  /** 可逆の音源（原本か、取り込み時の控え）があるか */
  has_lossless?: boolean;
  archive_ext?: string | null;
  archive_size?: number | null;
  /** 原本が残っているか */
  has_source?: boolean;
}

/** 画質。元の Web 版の STREAM_QUALITIES と、音声のみ */
export const STREAM_QUALITIES = ['1080p-60fps', '1080p', '810p', '720p', '540p', '480p', '360p', '240p'] as const;
export const AUDIO_ONLY = 'audio';
export type Quality = (typeof STREAM_QUALITIES)[number] | typeof AUDIO_ONLY;
export const qualityLabel = (q: Quality) => (q === AUDIO_ONLY ? '音声のみ' : q);

export const streamApi = (c: ApiClient) => ({
  meta: (target: StreamRef, node?: string | null) =>
    c.get<StreamMeta>(nodePath(node, `${streamBase(target)}/metadata`)),
  /** 仮想 HLS のプレイリスト。セッションは画質ごとに分ける（サーバーのセッションは動画＋画質に付く） */
  playlistUrl: (target: StreamRef, quality: Quality, sessionId: string, secondaryAudio: boolean, node?: string | null) =>
    c.url(nodePath(node, `${streamBase(target)}/${quality}/playlist?session_id=${sessionId}${secondaryAudio ? '&audio=secondary' : ''}`)),
  /** 再生中はセッションを保つ（止めると数十秒で片付けられる） */
  keepAlive: (target: StreamRef, quality: Quality, sessionId: string, node?: string | null) =>
    c.put<unknown>(nodePath(node, `${streamBase(target)}/${quality}/keep-alive?session_id=${sessionId}`)),
  /** そのまま再生する時のファイル（AV1 など HLS にできない動画・音楽） */
  mediaUrl: (videoId: number, node?: string | null) => c.url(nodePath(node, `/api/videos/${videoId}/media`)),
  /** 音楽の波形とスペクトラム（音楽だけ。無ければ失敗する） */
  audioViz: async (videoId: number, node?: string | null) => {
    const res = await fetch(c.url(nodePath(node, `/api/videos/${videoId}/audioviz`)), { headers: c.authHeaders(), credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseAudioViz(await res.arrayBuffer());
  },
  /**
   * キャプチャを保存する（このサーバーへ）。channel_id が vdb<番号> ならその動画のキャプチャとして残る。
   * tot: 撮った位置の放送時刻（一覧の「ここから」で使う）
   */
  saveCapture: (body: { image: string; station: string; channel_id: string; tot: string | null }) =>
    c.post<{ ok?: boolean; file?: string; error?: string }>('/api/streams/captures', body),
  /**
   * シークバーのサムネの画像。reflowed: 列を詰め直した iOS 向け（iOS は幅 16320px の旧い画像を読めない）。
   * 詰め直しはこのサーバーの録画だけ（他のサーバーへの中継は許可していない。元と同じ）
   */
  thumbnailTileUrl: (videoId: number, node: string | null | undefined, reflowed: boolean) =>
    c.url(reflowed && !node ? `/api/ios/thumbnail-tile/${videoId}` : nodePath(node, `/api/streams/vdb/${videoId}/thumbnail-tile`)),
});
