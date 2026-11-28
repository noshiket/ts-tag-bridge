import type { DuplicateVideo } from '../recordings/types';

/**
 * GET /api/reserves/augmented の1件（EDCB の予約に、このアプリの解析値・録画ルールの状態を足したもの）。
 * 一覧は軽い版で、番組詳細・解析の全体・重複の中身は入っていない（詳細で取り直す）
 */
export interface Reserve {
  reserve_id: number;
  /** 'addon' は EDCB に無い予約（アドオンが直接入れたもの） */
  source?: 'edcb' | 'addon' | string;
  onid: number;
  tsid: number;
  sid: number;
  event_id: number;
  title: string;
  station_name: string;
  genre: string;
  /** ISO 8601（+09:00） */
  start_time: string | null;
  duration_sec: number;
  description: string;
  /** 0 = 無効（スキップ） */
  rec_enabled: number;
  /** 録画ルールの状態（pending / recording / recorded / encoded / done / skipped / error） */
  rule_state: string | null;
  rule_id: number | null;
  auto_add_id: number | null;
  action: string | null;
  overlap_mode: number;
  comment: string;
  size: string;
  tags: string[];
  /** 解析の確定値（話数・フォルダなど。複数話は配列） */
  confirmed: Record<string, unknown> | null;
  parser_error: string[];
  duplicate_count: number;
  /** 'duplicate' = このアプリが既存の動画との重複で無効にした。EDCB 側・手動の無効は null */
  auto_skip_reason: string | null;
}

/** しょぼいカレンダーの番組表・作品情報から引いたこの放送の情報（詳細でだけ届く。番組表に無い放送は tid が無い） */
export interface ShoboiInfo {
  tid?: number | null;
  pid?: number | null;
  title?: string | null;
  short_title?: string | null;
  title_yomi?: string | null;
  count?: number | string | null;
  subtitle?: string | null;
  st_time?: string | null;
  ed_time?: string | null;
  prog_comment?: string | null;
  wiki_url?: string | null;
  wiki_title?: string | null;
  url?: string | null;
}

/** GET /api/reserves/augmented/<id>（詳細。一覧で落としている番組詳細・解析・重複の中身が入る） */
export interface ReserveDetail extends Reserve {
  extended_info: string;
  video_info: string;
  audio_info: string;
  free_ca?: boolean | null;
  rec_setting: Record<string, unknown>;
  text_parser_result: Record<string, unknown> | null;
  shoboi_info: ShoboiInfo | null;
  duplicate_info: DuplicateVideo[];
}

/** GET /api/tuner_reserves の1件（チューナーごとに割り当てられた予約） */
export interface TunerReserves {
  tuner_name: string;
  reserve_ids: number[];
}
