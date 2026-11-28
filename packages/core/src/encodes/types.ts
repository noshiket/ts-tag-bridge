/** GET /api/encode/recordings の1件（録画1話ぶんのエンコード） */
export interface EncodeJob {
  id: number;
  recording_id: number | null;
  video_id: number | null;
  title: string;
  folder: string;
  episode_number: string | null;
  episode_name: string;
  onid: number | null;
  sid: number | null;
  /** wait_encode / make_DB / split_ts / encoding / encoded_analyze / file_copy / delete / encode_end */
  state: string;
  /** エンコードを始めた時刻（時差付き ISO。記録前のサーバー・行は無い） */
  encoding_started_at?: string | null;
  priority: number | null;
  progress: number;
  error_message: string;
  /** 使うエンコードの設定（カテゴリ） */
  category: string;
  encode_dir: string;
  /** どの工程で失敗したか（やり直せる工程の上限） */
  failed_state: string | null;
  /** アドオンのエンコーダーの今の工程（Amatsukaze では無い） */
  addon_step: string | null;
  /** 出力先（{$encode_dir} などの置き換え前） */
  app_output_path: string;
  /** 切り出した区間（JSON の文字列か配列） */
  trim_segments: string | TrimSegment[] | null;
  recording_start_time: string;
  analyzed_recording_start_time: string;
  recording_end_time: string;
  analyzed_recording_end_time: string;
  updated_at: string;
}

export interface TrimSegment { start: string; end: string; duration_sec: number }

/** GET /api/encode/addon_jobs の1件（アドオンが積んだ、動画への変換などの仕事。録画に紐づかない） */
export interface AddonJob {
  encId: number;
  addon: string | null;
  videoId: number | null;
  title: string;
  folder: string;
  state: string;
  priority: number;
  progress: number;
  errorMessage: string;
  updatedAt: string | null;
}
