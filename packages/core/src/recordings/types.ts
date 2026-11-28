import type { ShoboiInfo } from '../reserves/types';

/** 既存の動画との重複（確定値が一致した動画）。一覧のカードに局・勢い・問題を添える */
export interface DuplicateVideo {
  id: number;
  origin_peer?: string | null;
  eit_station_name: string | null;
  sid: number | null;
  comment_count: number | null;
  duration_sec: number | null;
  has_issue?: boolean;
  drop_count?: number;
  scramble_count?: number;
  announce?: string | null;
  /** 詳細で届く（予約・録画の詳細の「登録済み VIDEO」） */
  series?: string | null;
  album?: string | null;
  episode_number?: string | number | null;
  episode_name?: string | null;
  /** その動画のシリーズ（ビデオカードで出す時に、そのシリーズの動画一覧から引く。古いサーバーは来ない） */
  series_id?: number | null;
}

/** GET /api/recordings/augmented の items の1件（EDCB の録画結果に、このアプリの解析・処理の状態を足したもの） */
export interface Recording {
  /** EDCB の録画結果の番号（手動登録は別の番号） */
  id: number;
  /** このアプリの録画の番号（サムネ・詳細はこちら） */
  db_rec_id: number | null;
  title: string;
  service_name: string;
  onid: number;
  tsid: number;
  sid: number;
  event_id: number;
  /** ISO 8601 */
  start_time: string | null;
  duration_sec: number | null;
  rec_file_path: string;
  drops: number;
  scrambles: number;
  protect_flag: boolean;
  comment: string;
  /** EDCB の録画の状態（0 録画中 / 1 正常 / 2 エラー / 3 中断 / 4 スキップ） */
  rec_status: number | null;
  /** このアプリの処理の段階（pending / scanning / … / encode_finish） */
  state: string | null;
  /** null = まだ調べていない */
  file_exist: boolean | number | null;
  is_manual: boolean;
  manual_id: number | null;
  comment_count: number | null;
  duplicate_info: DuplicateVideo[];
  /** 別のサーバーへエンコードを任せた時の送り具合 */
  transfer_state: { node: string; phase: string; sent: number; total: number } | null;
  confirmed: Record<string, unknown> | null;
  parser_error: string[];
}

/** 絞込に出す件数（サーバーが今の条件で数えたもの） */
export interface RecordingSummary {
  stations?: Record<string, number>;
  genres?: Record<string, number>;
  folder_with?: number;
  folder_without?: number;
  ep_multi?: number;
  ep_single?: number;
  ep_none?: number;
  rec_statuses?: Record<string, number>;
  states?: Record<string, number>;
  parser_err_yes?: number;
  parser_err_no?: number;
  file_exist_yes?: number;
  file_exist_no?: number;
  file_exist_null?: number;
  drop_yes?: number;
  drop_no?: number;
}

export interface RecordingPage {
  items: Recording[];
  total: number;
  page: number;
  per_page: number;
  summary: RecordingSummary;
}

/** GET /api/recordings/augmented/<db_rec_id>（詳細。一覧で落としている解析の全体などが入る） */
export interface RecordingDetail extends Recording {
  edcb_title: string | null;
  description: string;
  extended_info: string;
  eit_genre: string;
  eit_video_info: string;
  eit_audio_info: string;
  eit_end_time?: string | null;
  eit_overlap: number | null;
  edcb_tag: string;
  file_size: number | null;
  recording_start_time: string | null;
  recording_end_time: string | null;
  rule_id: number | null;
  is_text_parser: number | boolean;
  text_parser_result: Record<string, unknown> | null;
  shoboi_info: ShoboiInfo | null;
  scan_cancelled?: boolean;
  /** 分割の区切り（話ごと） */
  segments: string[] | string | null;
  drop_error: unknown;
  /** 録画ごとのエンコードの設定（JSON の文字列で届くこともある） */
  to_encode_info: unknown;
}

/** GET /api/encode/recordings/<id>/probe（TS の映像・音声の中身） */
export interface RecordingProbe {
  video?: { codec: string; width: number; height: number; fps: number } | null;
  audio?: { codec: string; channels: number; sample_rate: number }[];
}
