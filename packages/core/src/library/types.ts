// ライブラリ（video.db）の応答。サーバーの JSON の名前のまま持つ
// （画面用に名前を付け替えると、その対応表を保守する手間が増えるだけなので）。
// 画面で使う欄だけを書く。増やす時はサーバーの応答を見て足す。

/** GET /api/videos/albums の1件 */
export interface AlbumSummary {
  id: number;
  name: string;
  description: string | null;
  genre: string | null;
  categories: string[];
  /** アルバムの中のシリーズ名（見える動画があるもの）。古いサーバーには無い */
  series_names?: string[];
  /** 動画が置かれている保存先（encode_dir_list の各パス）。複数ディスクにまたがると両方 */
  dirs: string[];
  video_count: number;
  /** アルバム名と違うフォルダに置かれた動画のフォルダ名（分類エラー） */
  folder_mismatch: string[];
  folder_mismatch_count: number;
  in_mylist: boolean;
  /** ISO 8601。放送日時（+09:00 付き） */
  earliest_broadcast_at: string | null;
  latest_broadcast_at: string | null;
  /** ISO 8601。動画を足した日時（時差なし＝サーバーの現地時刻） */
  latest_video_at: string | null;
  /** サムネの取り直しに使う（URL に付ける） */
  latest_video_updated_at: string | null;
  /** ISO 8601（UTC）。この利用者が最後に見た日時 */
  latest_watch_at: string | null;
  /** 新着: 前の話を見終えた後に次の話が追加され、まだ見ていない（ログイン中だけ。古いサーバーには無い） */
  has_new_episode?: boolean;
}

/** GET /api/videos/albums/<id> */
export interface AlbumDetail {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  series: Series[];
}

/** アルバムの中のシリーズ（GET /api/videos/series/<id>/videos も同じ形） */
export interface Series {
  id: number;
  album_id: number;
  name: string;
  furigana: string | null;
  sort_order: number;
  thumbnail_path: string | null;
  created_at: string | null;
  updated_at: string | null;
  videos: Video[];
}

export interface Video {
  id: number;
  /** null は映像（'audio' は音楽） */
  media_kind: 'audio' | null;
  episode_number: string | null;
  episode_name: string | null;
  eit_title: string | null;
  eit_station_name: string | null;
  /** ISO 8601（+09:00 付き） */
  eit_start_time: string | null;
  duration_sec: number | null;
  file_size: number | null;
  has_caption: number;
  has_secondary_audio: number;
  comment_count: number | null;
  thumbnail_path: string | null;
  artist: string | null;
  sort_order: number;
  sid: number | null;
  onid: number | null;
  /** 放送の識別子（動画が移っても変わらない。ローカル保存の張り替えに使う） */
  tsid?: number | null;
  eid?: number | null;
  file_path: string | null;
  /** アルバム名と違うフォルダに置かれている（分類エラー） */
  folder: string | null;
  folder_mismatch: boolean;
  setting: string | null;
  eit_audio_info: string | null;
  recording_start_time: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** 映像コーデック（null は放送由来の H.264 / MPEG-2 など） */
  video_codec: string | null;
  /** drop / scramble の結果（JSON 文字列） */
  drop_error: string | null;
  /** 放送異常の告知。'none(...)' なら無し */
  announce: string | null;
  allow_duplicate: number;
  /** 音声比較で他の放送から取り込んだ字幕・実況 */
  has_added_caption: number;
  added_comment_tracks: number;
  /** 一番多い実況トラックの件数（取り込んだものを含む） */
  max_comment_count: number | null;
  categories: { id: number; name: string }[];
}

/** GET /api/videos/albums/<id>/captures の1件 */
export interface Capture {
  id: number;
  /** 画像のファイル名（/api/streams/captures/<path>） */
  path: string;
  video_id: number | null;
  series_id: number | null;
  series_name: string | null;
  eit_title: string | null;
  episode_number: string | null;
  episode_name: string | null;
  /** 撮った位置の放送時刻（ISO 8601）。ここから再生できる */
  tot: string | null;
  created_at: string | null;
}

/** GET /api/streams/captures の1件（ライブラリ全体のキャプチャ） */
export interface LibraryCapture {
  id: number;
  /** 画像のファイル名 */
  file: string;
  album: string | null;
  album_id: number | null;
  video_id: number | null;
  eit_title: string | null;
  eit_station_name?: string | null;
  tot: string | null;
  created_at: string | null;
}

/** アルバムごとのまとまり（並びは一覧に出てきた順 = そのアルバムで最後に撮ったものが新しい順） */
export interface CaptureGroup { key: string; albumId: number | null; name: string; items: LibraryCapture[] }
export function groupCapturesByAlbum(list: LibraryCapture[]): CaptureGroup[] {
  const groups: CaptureGroup[] = [];
  const byKey = new Map<string, CaptureGroup>();
  for (const c of list) {
    const key = c.album_id != null ? `a${c.album_id}` : 'none';
    let g = byKey.get(key);
    if (!g) {
      g = { key, albumId: c.album_id ?? null, name: c.album || (c.video_id != null ? '未分類' : 'アルバム未紐づけ'), items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(c);
  }
  return groups;
}
