// ライブラリの動画カードの「詳細」の操作（元の encode.jsx の VideoRow の詳細シート）
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { FrameTable } from '../stream/clipFrames';

const PARSE_TIMEOUT_MS = 60_000;

/** 解析結果の名前 → 確定値の列（カードの「解析値を確定値に反映」用。auto_send は扱わない） */
const TP_TO_DB: Record<string, string> = {
  title: 'title', folder: 'folder', episode_name: 'episode_name', 't-episode_name': 'episode_name', episode_number: 'episode_number',
  category: 'category', furigana: 'furigana', else: 'else_info', app_output_path: 'app_output_path',
  app_output_path_format: 'app_output_path_format', setting: 'setting',
};
const FIELDS = ['title', 'folder', 'episode_name', 'episode_number', 'category', 'furigana', 'else_info', 'app_output_path_format', 'app_output_path', 'setting'];

/**
 * 「解析値を確定値に反映」で送る中身: 今の確定値の上に解析値を重ねる。
 * 複数話まとめ録画の解析値は話数ぶんの並びなので、並びのまま送る（サーバーが単話へ縮める。文字にすると2話つながったパスになる）。
 * category だけはカテゴリ名の並びなので文字にし、2つ以上なら並びに戻す
 */
export function videoApplyParseBody(confirmed: Record<string, unknown>, tp: Record<string, unknown>): Record<string, unknown> {
  const one = (v: unknown, k: string): unknown => (k === 'category' || !Array.isArray(v) ? (Array.isArray(v) ? v.join(', ') : String(v)) : v);
  const body: Record<string, unknown> = {};
  for (const k of FIELDS) body[k] = confirmed[k] == null ? '' : one(confirmed[k], k);
  body.encode_dir = confirmed.encode_dir != null ? String(confirmed.encode_dir) : '';
  for (const [tpKey, dbKey] of Object.entries(TP_TO_DB)) if (tp[tpKey] != null) body[dbKey] = one(tp[tpKey], dbKey);
  body.is_text_parser = 1;
  if (typeof body.category === 'string') {
    const parts = body.category.split(',').map((x) => x.trim());
    body.category = parts.length > 1 ? parts : parts[0] || null;
  }
  return body;
}

export interface VideoAddonParam { key: string; label: string; type?: string; default?: unknown; required?: boolean; options?: unknown[]; description?: string }
export interface VideoAddon { name: string; label: string; description?: string; error?: string | null; params?: VideoAddonParam[] }
/**
 * 再生画面のタブを増やすアドオン（target='player_tab'）。タブの中身はアドオンの名前ではなく player_ui で選ぶ。
 * 無い・画面が知らない値なら params の入力欄と実行だけの汎用の画面（アドオンを足しても画面の作り直しは要らない）
 */
export interface PlayerTabAddon extends VideoAddon {
  /** 'video' = ライブラリの動画（既定）、'recording' = 録画の TS */
  source?: 'video' | 'recording' | string;
  tab_label?: string;
  player_ui?: 'chapters' | 'clip_range' | 'logo_rect' | string | null;
}
export interface AddonRunJob { state: 'running' | 'done' | 'error' | string; addon?: string; log?: string[]; result?: unknown; error?: string | null }

/** アドオンの入力の始めの値（既定値。無ければ真偽は false、他は空） */
export function addonInitialValues(params: VideoAddonParam[] = []): Record<string, unknown> {
  return Object.fromEntries(params.map((p) => [p.key, p.default != null ? p.default : p.type === 'bool' ? false : '']));
}
/** 要る項目が空なら、その項目の名前 */
export function missingAddonParam(params: VideoAddonParam[] = [], vals: Record<string, unknown>): string | null {
  const p = params.find((x) => x.required && (vals[x.key] == null || String(vals[x.key]).trim() === ''));
  return p ? p.label : null;
}

/** GET /api/videos/:id/confirmed（確定値・解析値と、解析のプレビューに要る番組の情報） */
export interface VideoConfirmed {
  confirmed?: Record<string, unknown>; parseResult?: Record<string, unknown> | null; parser_error?: string[] | null;
  media_kind?: 'audio' | null; episode_idx?: number | null;
  title?: string; sid?: number | null; onid?: number | null; tsid?: number | null; service_name?: string | null;
  start_time?: string | null; description?: string | null; extended_info?: string | null;
}

/**
 * ファイルを動かす操作（置き場所・フォルダ名・シリーズ名の変更）を待つ時間。動画のコピーは数 GB あり、
 * ふつうの読み込みと同じ 8 秒で打ち切ると、サーバーでは移せたのに画面は「応答がありません」になり、
 * 古い番号のまま残って 404 になった（2026-11-19）
 */
export const FILE_MOVE_TIMEOUT_MS = 30 * 60_000;

/** relocate の答え（移動したか・id が変わったか） */
/** pushed: 連携先（マスター）へ移した（移った先の番号はここでは分からない） */
export interface RelocateResult { relocated?: boolean; updated?: boolean; pushed?: boolean; error?: string; new_video_id?: number; old_video_id?: number }

export const videoActionsApi = (c: ApiClient) => ({
  /** 解析値の再解析（確定値は変えない）。fresh: しょぼいカレンダーに問い合わせ直してから */
  reparse: (id: number, fresh: boolean, node?: string | null) =>
    c.post<{ text_parser_result?: { parser_error?: unknown[] }; sent_request?: unknown }>(nodePath(node, `/api/videos/${id}/reparse${fresh ? '?fresh=1' : ''}`), {}, { timeoutMs: PARSE_TIMEOUT_MS }),
  /** 放送異常告知（テロップ等）をしょぼいカレンダーから取り直す。取れなければ fetched=false で、今の値は変えない */
  fetchAnnounce: (id: number, node?: string | null) =>
    c.post<{ announce: string | null; fetched: boolean }>(nodePath(node, `/api/videos/${id}/fetch_announce`), {}),
  /** テロップの有無を手で決める（有=「テロップ(手動)」/ 無=「none(手動)」。none 始まりはなし） */
  setAnnounce: (id: number, value: string, node?: string | null) =>
    c.patch<{ announce: string }>(nodePath(node, `/api/videos/${id}/announce`), { value }),
  /** 実況コメントを取り直す（増えた時だけ入れ替わる） */
  refetchComments: (id: number, node?: string | null) =>
    c.post<{ updated: boolean; before: number; after: number }>(nodePath(node, `/api/videos/${id}/comments/refetch`), {}),
  /** サムネイルを拾い直す（無ければ作り直しの仕事を積む） */
  regenerateThumbnail: (id: number, node?: string | null) =>
    c.post<{ fixed?: 'path'; job_id?: string }>(nodePath(node, `/api/videos/${id}/thumbnail/regenerate`), { force: false }),
  /** 音声解析の仕事（サムネの作り直しもこれで見る） */
  audioJob: (jobId: string, node?: string | null) => c.get<{ state: string; error?: string | null }>(nodePath(node, `/api/audio-compare/jobs/${jobId}`)),
  /** 動画の確定値と解析値 */
  confirmed: (id: number, node?: string | null) =>
    c.get<VideoConfirmed>(nodePath(node, `/api/videos/${id}/confirmed`)),
  /** 確定値のフォルダ・パスへ実際のファイルを動かす（id が変わることがある） */
  /** 置き場所を変える（動画を丸ごとコピーして確かめてから元を消すので、数 GB だと数十秒かかる） */
  relocate: (id: number, node?: string | null) =>
    c.post<RelocateResult>(nodePath(node, `/api/videos/${id}/relocate`), {}, { timeoutMs: FILE_MOVE_TIMEOUT_MS }),
  allowDuplicate: (id: number, allow: boolean, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/videos/${id}/allow_duplicate`), { allow }),
  /** ライブラリから消す（ファイルも消す。元に戻せない） */
  remove: (id: number, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/videos/${id}`)),
  /** シリーズの中で並べ替える（設定順の時） */
  move: (seriesId: number, videoId: number, direction: 'up' | 'down', node?: string | null) =>
    c.put<unknown>(nodePath(node, `/api/videos/series/${seriesId}/videos/${videoId}/move`), { direction }),
  /** 動画の tag.json（無ければ exists=false） */
  tag: (id: number, node?: string | null) =>
    c.get<{ tag?: Record<string, unknown>; tag_path?: string; exists?: boolean }>(nodePath(node, `/api/videos/${id}/tag`)),
  /** tag.json を保存する。apply でライブラリ（video.db）にも反映し、反映した列を返す */
  saveTag: (id: number, tag: Record<string, unknown>, apply: boolean, node?: string | null) =>
    c.put<{ applied?: boolean; updated?: string[] }>(nodePath(node, `/api/videos/${id}/tag`), { tag, apply }),
  /** 動画に使えるアドオン */
  addons: (node?: string | null) => c.get<VideoAddon[]>(nodePath(node, '/api/addons?target=video')),
  /** 動画にアドオンを動かす（仕事の番号を返す） */
  runAddon: (id: number, name: string, params: Record<string, unknown>, node?: string | null) =>
    c.post<{ job_id: string }>(nodePath(node, `/api/videos/${id}/addons/${encodeURIComponent(name)}/run`), params),
  /** 再生画面のタブを増やすアドオン（有効なものだけ） */
  playerTabs: (node?: string | null) => c.get<PlayerTabAddon[]>(nodePath(node, '/api/addons?target=player_tab')),
  addonJob: (jobId: string, node?: string | null) => c.get<AddonRunJob>(nodePath(node, `/api/addons/jobs/${jobId}`)),
  /** 後から取り込んだ字幕・実況のトラック */
  addedTracks: (id: number, node?: string | null) =>
    c.get<{ comments?: { key: string; name?: string; count?: number }[]; captions?: { key: string; name?: string }[] }>(nodePath(node, `/api/videos/${id}/added-tracks`)),
  /** 切り抜き用のフレーム表（無ければ table が空） */
  frameTable: (id: number, node?: string | null) =>
    c.get<{ table?: FrameTable | null }>(nodePath(node, `/api/videos/${id}/frame_table`)),
  /** その時刻のコマの静止画 */
  frameUrl: (id: number, t: number, node?: string | null, w = 640) =>
    c.url(nodePath(node, `/api/videos/${id}/frame?t=${Number(t).toFixed(6)}&w=${w}`)),
  /** アドオンが作ったファイル（切り抜きの MP4 など。取りに来るとサーバー上の一時ファイルは消える） */
  addonFileUrl: (addon: string, file: string, name: string, node?: string | null) =>
    c.url(nodePath(node, `/api/addons/${encodeURIComponent(addon)}/files/${encodeURIComponent(file)}?name=${encodeURIComponent(name)}`)),
  /** 端末へ保存する動画（tag.json・サムネを埋め込んである） */
  downloadUrl: (id: number, node?: string | null) => c.url(nodePath(node, `/api/videos/${id}/download?embed=1&attach=1`)),
});
