// ローカル保存（元の Web 版の helpers.jsx の VideoCache）の決まりごと。保存先の仕組みは端末ごとに違うので
// アプリの側に置き、ここには鍵・保存できる形式・控える情報・補助データの取り方だけを置く
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { Video } from '../library/types';
import type { StreamMeta } from '../stream/api';
import type { CaptionEntry } from '../stream/captions';
import { normalizeCommentPayload, type Comment, type CommentPayload } from '../stream/comments';
import type { StreamMarks } from '../stream/navigation';

/** 保存できる形式（拡張子 → 型）。これ以外（TS など）は保存できない。元と同じ */
export const LOCAL_SAVE_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  mkv: 'video/x-matroska', webm: 'video/webm',
  m4a: 'audio/mp4', mp3: 'audio/mpeg', flac: 'audio/flac', aac: 'audio/aac',
};
export const localSaveMime = (path: string | null | undefined) =>
  LOCAL_SAVE_MIME[(String(path || '').split('.').pop() || '').toLowerCase()] || '';

/**
 * 保存の鍵。動画の番号はサーバーごとに別なので、他のサーバーの動画は "<サーバー>~<番号>"。
 * 自サーバーは番号だけ（元と同じ。Web は元の保存をそのまま読めるようにする）
 */
export const localKey = (id: number, node: string | null | undefined) => (node ? `${node}~${id}` : String(id));
export function parseLocalKey(ck: string): { id: number; node: string | null } {
  const i = ck.indexOf('~');
  return i < 0 ? { id: Number(ck), node: null } : { id: Number(ck.slice(i + 1)), node: ck.slice(0, i) };
}

/** 保存した時に控える表示の情報（一覧・オフラインの時に使う。元の dlMeta と同じ名前） */
export interface LocalSaveMeta {
  title: string;
  series: string;
  episodeNum: string;
  episodeName: string;
  /** 再生する時の型（MKV/WebM を mp4 として読ませると再生できない） */
  mime: string;
  onid: number | null;
  sid: number | null;
  tsid?: number | null;
  eid?: number | null;
  stationName: string;
  hasCaption: boolean;
  commentCount: number;
  durationSec: number | null;
  eitStartTime: string;
  recStart: string;
  /** 保存し終えた時刻（ISO 8601） */
  cachedAt?: string;
  /** どちらの音声で保存したか */
  audio?: 'main' | 'secondary';
}

/** 一覧の1件（保存済み・保存中） */
export interface LocalItem extends Partial<LocalSaveMeta> { id: number; node: string | null }

export function localSaveMetaOf(v: Video, series: string | null | undefined): LocalSaveMeta {
  const epNum = v.episode_number ?? '';
  return {
    title: v.eit_title || '', series: series || '', episodeNum: epNum, episodeName: v.episode_name || '',
    mime: localSaveMime(v.file_path), onid: v.onid, sid: v.sid, tsid: v.tsid ?? null, eid: v.eid ?? null, stationName: v.eit_station_name || '',
    hasCaption: !!v.has_caption, commentCount: v.max_comment_count ?? v.comment_count ?? 0, durationSec: v.duration_sec,
    eitStartTime: v.eit_start_time || '', recStart: v.recording_start_time || '',
  };
}

/** 保存済みを新しい順に */
export const sortLocalItems = <T extends { cachedAt?: string }>(items: T[]) =>
  [...items].sort((a, b) => String(b.cachedAt || '').localeCompare(String(a.cachedAt || '')));

/**
 * 再生の補助データ（番組情報・実況・ドロップ・字幕）。オフラインで再生する時にサーバーの代わりに使う。
 * 実況は取り込んだ追加のトラックごと残すので、返ってきたものをそのまま持つ（古い保存は配列）
 */
export interface LocalSidecar {
  metadata: StreamMeta | null;
  comments: CommentPayload | Comment[];
  drops: StreamMarks | null;
  captions: Record<string, CaptionEntry[]>;
}

/** 保存したコメント（主のトラックと取り込んだ追加のトラック。古い保存はコメントの配列そのもの） */
export const sidecarComments = (s: Pick<LocalSidecar, 'comments'>): CommentPayload => normalizeCommentPayload(s.comments);

/** 取る字幕のトラック。番組情報に無ければ 1・2（元と同じ） */
export function captionTrackKeys(meta: StreamMeta | null): string[] {
  const keys = ((meta as { caption_tracks?: { key: string }[] } | null)?.caption_tracks ?? []).map((t) => t.key);
  return keys.length ? keys : ['1', '2'];
}

export const localSaveApi = (c: ApiClient) => {
  const opt = <T>(p: Promise<T>) => p.catch(() => null);
  return {
    /** 動画本体（secondary: 副音声版をサーバーで作って渡す） */
    downloadUrl: (id: number, node: string | null, secondary: boolean) =>
      c.url(nodePath(node, `/api/videos/${id}/download${secondary ? '?audio=secondary' : ''}`)),
    posterUrl: (id: number, node: string | null) => c.url(nodePath(node, `/api/videos/${id}/thumbnail`)),
    tileUrl: (id: number, node: string | null) => c.url(nodePath(node, `/api/streams/vdb/${id}/thumbnail-tile`)),
    /** 補助データをまとめて取る。取れなかった物は空にする（元の _fetchSidecar と同じ） */
    sidecar: async (id: number, node: string | null): Promise<LocalSidecar> => {
      const base = nodePath(node, `/api/streams/vdb/${id}`);
      const metadata = await opt(c.get<StreamMeta>(`${base}/metadata`));
      // 音楽は字幕も実況もドロップも持たないので取りに行かない
      if (metadata?.media_kind === 'audio') return { metadata, comments: { comments: [] }, drops: null, captions: {} };
      const keys = captionTrackKeys(metadata);
      const [comments, drops, caps] = await Promise.all([
        opt(c.get<{ comments: Comment[] }>(`${base}/comments`)),
        opt(c.get<StreamMarks>(`${base}/drops`)),
        Promise.all(keys.map((k) => opt(c.get<{ captions: CaptionEntry[] }>(`${base}/captions-data?track=${encodeURIComponent(k)}`)))),
      ]);
      const captions: Record<string, CaptionEntry[]> = {};
      keys.forEach((k, i) => { captions[k] = caps[i]?.captions ?? []; });
      return { metadata, comments: comments && typeof comments === 'object' ? comments : { comments: [] }, drops: drops ?? null, captions };
    },
    /**
     * 放送から動画を探す（番号が変わった保存分の張り替え先）。録画時刻まで渡す:
     * 一挙放送を話数で分けると放送の識別子は全話で同じになるため（元と同じ）
     */
    findByBroadcast: async (m: Pick<LocalSaveMeta, 'onid' | 'sid' | 'tsid' | 'eid' | 'eitStartTime' | 'recStart'>, node: string | null) => {
      if (m.onid == null || m.sid == null || !m.eitStartTime) return null;
      const p = new URLSearchParams({ onid: String(m.onid), sid: String(m.sid), eit_start_time: m.eitStartTime });
      if (m.tsid != null) p.set('tsid', String(m.tsid));
      if (m.eid != null) p.set('eid', String(m.eid));
      if (m.recStart) p.set('recording_start_time', m.recStart);
      const r = await c.get<{ id?: number | null }>(nodePath(node, `/api/videos/find_by_broadcast?${p}`));
      return r?.id ?? null;
    },
    /** 副音声版を作った一時ファイルを片付けてもらう（取り終えたら要らない） */
    deleteSecondary: (id: number, node: string | null) =>
      opt(c.delete<unknown>(nodePath(node, `/api/videos/${id}/download/secondary`))),
  };
};
