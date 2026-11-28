// tag.json から確定値タブの中身（GET /api/videos/<id>/confirmed の答え）を作る。
// 端末に保存した動画を通信なしで開いた時に、保存した tag.json から同じ形を出すため。
// サーバーの _video_confirmed_dict_from_tag（server/api/video_routes/confirmed/tag.py）と同じ計算。片方だけ変えないこと
import type { VideoConfirmed } from './videoActions';

/** 複数話の解析結果で、話ごとに値が並ぶ項目（サーバーの _PER_EPISODE_TP_FIELDS） */
const PER_EPISODE = new Set(['episode_name', 'episode_number']);
const FIELDS = ['title', 'folder', 'episode_number', 'episode_name', 'furigana', 'else_info', 'app_output_path_format', 'app_output_path', 'setting'];

type Tag = Record<string, unknown>;

/** 複数話の解析結果を、この動画の1話へ縮める */
function reduceTp(tp: Tag, idx: number): Tag {
  if (!Array.isArray(tp.episode_number)) return tp;
  return Object.fromEntries(Object.entries(tp).map(([k, v]) => [k, PER_EPISODE.has(k) && Array.isArray(v) && idx < v.length ? v[idx] : v]));
}

export function confirmedFromTag(tag: Tag): VideoConfirmed {
  let full: unknown = tag.text_parser_result ?? {};
  if (typeof full === 'string') { try { full = JSON.parse(full); } catch { full = {}; } }
  const tpFull = (full && typeof full === 'object' ? full : {}) as Tag;
  const idx = typeof tag.episode_idx === 'number' && tag.episode_idx >= 0 ? tag.episode_idx : 0;
  // 確定値は保存した時に1話へ縮めてあるが、配列が残っていれば episode_idx で選ぶ（カテゴリは名前の配列なのでそのまま）
  const one = (v: unknown) => (Array.isArray(v) ? (idx < v.length ? v[idx] : v[0] ?? null) : v ?? null);
  const confirmed: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, one(tag[k])]));
  for (const k of ['category', 'eit_genre', 'eit_start_time', 'eit_description', 'encode_dir']) confirmed[k] = tag[k] ?? null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    confirmed, parseResult: reduceTp(tpFull, idx), parser_error: [],
    media_kind: tag.media_kind === 'audio' ? 'audio' : null, episode_idx: idx,
    title: str(tag.eit_title), sid: num(tag.sid), onid: num(tag.onid), tsid: num(tag.tsid),
    service_name: str(tag.eit_station_name), start_time: str(tag.eit_start_time),
    description: str(tag.eit_description), extended_info: str(tag.eit_extended_info),
  };
}
