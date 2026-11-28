// ライブラリへ動画を足す（元の encode.jsx の AddVideoSheet）。「動画追加」は情報を打って tag.json を作り、
// 「tagビデオ追加」は既存の tag.json（無ければ動画に埋め込んだ情報）から登録する。どちらもこのサーバーへ
import type { ApiClient } from '../http/client';
import type { Service } from '../epg/guide';

export const ADD_VIDEO_FIELDS = [
  'file_path', 'folder', 'title', 'episode_number', 'episode_name', 'eit_title', 'eit_station_name', 'eit_start_time', 'eit_end_time',
  'eit_description', 'eit_extended_info', 'eit_genre', 'eit_video_info', 'eit_audio_info', 'onid', 'tsid', 'sid', 'eid',
  'recording_start_time', 'recording_end_time', 'setting', 'edcb_tag', 'announce', 'encode_dir', 'furigana', 'app_output_path_format',
] as const;
export type AddVideoForm = Record<(typeof ADD_VIDEO_FIELDS)[number], string>;
export const emptyAddVideoForm = (): AddVideoForm => Object.fromEntries(ADD_VIDEO_FIELDS.map((k) => [k, ''])) as AddVideoForm;

/** 'keep' = そのまま / 'move' = ライブラリへ移す / 'copy' = 原本を残して複製 */
export type Place = 'keep' | 'move' | 'copy';
export interface KnownStation { name: string; onid: number | null; tsid: number | null; sid: number | null }

/** 「動画追加」の中身。アップロードは一時置き場に入っているので、登録と同時に必ず移す */
export function addManualBody(f: AddVideoForm, categories: string[], place: Place, uploaded: boolean, destDir: string) {
  return { ...f, category: categories, place: uploaded ? 'move' : place, encode_dir: destDir };
}

/** 一覧から選んだ局を入れる（局名と onid/tsid/sid がそろって入る。局のロゴと他のサーバーとの重複の判定に効く） */
export function pickService(f: AddVideoForm, services: Service[], key: string): AddVideoForm {
  const sv = services.find((x) => `${x.onid}-${x.tsid}-${x.sid}` === key);
  return sv ? { ...f, eit_station_name: sv.service_name, onid: String(sv.onid), tsid: String(sv.tsid), sid: String(sv.sid) } : f;
}
/** 局名を直に打った時: ライブラリか一覧にある局ならその識別子、無ければ空（登録の時にサーバーが割り当てる） */
export function typeStation(f: AddVideoForm, name: string, known: KnownStation[], services: Service[]): { form: AddVideoForm; key: string } {
  const n = name.trim();
  const k = known.find((x) => x.name === n) ?? services.map((sv) => ({ name: sv.service_name, onid: sv.onid, tsid: sv.tsid, sid: sv.sid })).find((x) => x.name === n);
  const s = (v: number | null | undefined) => (v != null ? String(v) : '');
  return { form: { ...f, eit_station_name: name, onid: k ? s(k.onid) : '', tsid: k ? s(k.tsid) : '', sid: k ? s(k.sid) : '' }, key: k ? `${k.onid}-${k.tsid}-${k.sid}` : '' };
}

/** ジャンルの候補（EPG と同じ「大 > 中」） */
export const genreOptions = (types: { genre: string; sub_genre: string | null }[]) =>
  [...new Set(types.map((g) => (g.sub_genre ? `${g.genre} > ${g.sub_genre}` : g.genre)))];

export interface AddVideoResult { id: number; warning?: string; source?: string; thumbnails?: unknown[]; captures?: number }
/** 登録できた時の言い方（AV1 など変換の経路に載らないものは警告にする） */
export function addResultMessage(r: AddVideoResult): { ok: boolean; text: string } {
  const extra = [
    r.source && r.source !== 'tag.json' ? `${r.source}から復元` : '',
    r.thumbnails?.length ? `サムネ${r.thumbnails.length}件を書き出し` : '',
    r.captures ? `キャプチャ${r.captures}件を紐づけ` : '',
  ].filter(Boolean).join(' / ');
  return r.warning ? { ok: false, text: `登録しました (video id: ${r.id})。⚠ ${r.warning}` } : { ok: true, text: `登録しました (video id: ${r.id})${extra ? ` — ${extra}` : ''}` };
}

/** 音楽のフォルダの中の1曲 */
export interface MusicFile { track?: number | string | null; title: string; artist?: string; album?: string; dest?: string; cover?: boolean; registered?: boolean }

export const addVideoApi = (c: ApiClient) => ({
  /** 置ける場所（encode_dir_list。マウントされていないものも返る） */
  uploadRoots: () => c.get<{ path: string; exists: boolean }[]>('/api/videos/upload_roots'),
  /** パス形式の既定（config.yml の output_path）と、ライブラリにある局 */
  manualDefaults: () => c.get<{ app_output_path_format?: string; stations?: KnownStation[] }>('/api/videos/add_manual_defaults'),
  contentTypes: () => c.get<{ content_nibble: number; genre: string; sub_genre: string | null }[]>('/api/content_types'),
  addManual: (body: Record<string, unknown>) => c.post<AddVideoResult>('/api/videos/add_manual', body),
  /** tag.json か動画のパスから。encodeDir を渡すと tag.json の app_output_path に従ってそこへ移してから */
  addFromTag: (tagPath: string, replace: boolean, encodeDir?: string) =>
    c.post<AddVideoResult>('/api/videos/add_from_tag', { tag_path: tagPath, replace, ...(encodeDir ? { encode_dir: encodeDir } : {}) }),
  /** 音楽のフォルダの中身を見る（タグを読むだけ。何も書かない） */
  scanMusic: (dir: string, encodeDir: string) =>
    c.post<{ dir: string; files?: MusicFile[] }>('/api/videos/music/scan', { dir, encode_dir: encodeDir || undefined }),
  /** 音楽をフォルダごと再生用 MP4 へ変えて登録する（順番待ちの仕事。原本は動かさない） */
  importMusic: (dir: string, encodeDir: string) =>
    c.post<{ job_id: string }>('/api/videos/music/import', { dir, encode_dir: encodeDir || undefined }),
  /** アップロードの送り先（数 GB になるので本体をそのまま送る。サーバーの一時置き場に入る） */
  uploadUrl: (name: string) => c.url(`/api/videos/upload?${new URLSearchParams({ name })}`),
});
