import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';

/** 再解析は時間がかかることがある（元と同じ 60 秒） */
const PARSE_TIMEOUT_MS = 60_000;
const fresh = (f: boolean) => (f ? '?fresh=1' : '');

export const confirmedApi = (c: ApiClient) => ({
  /** 予約（録画ルール）の確定値 */
  saveRule: (ruleId: number, body: Record<string, unknown>, node?: string | null) => c.patch<unknown>(nodePath(node, `/api/rules/${ruleId}`), body),
  /** 録画の確定値（分割の区切りが変わると segments が返る） */
  saveRecording: (dbRecId: number, body: Record<string, unknown>, node?: string | null) =>
    c.patch<{ segments?: unknown }>(nodePath(node, `/api/encode/recordings/${dbRecId}/confirmed`), body),
  /** ライブラリの動画の確定値 */
  saveVideo: (videoId: number, body: Record<string, unknown>, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/videos/${videoId}/confirmed`), body),
  /** パス形式を、今の値で実際のパスにする */
  resolvePath: async (template: string, fields: Record<string, unknown>, node?: string | null) =>
    (await c.post<{ path: unknown }>(nodePath(node, '/api/patterns/resolve_path'), { template, fields })).path,
  /** 予約の再解析。fresh: しょぼいカレンダーに問い合わせ直してから（規制中は後回し） */
  reparseRule: (ruleId: number, title: string, f: boolean, node?: string | null) =>
    c.post<{ text_parser_result?: Record<string, unknown>; text_parser_context?: unknown }>(
      nodePath(node, `/api/rules/${ruleId}/reparse${fresh(f)}`), { title }, { timeoutMs: PARSE_TIMEOUT_MS }),
  /** エンコードの選択肢（出力先のディスクなど） */
  encodeOptions: (node?: string | null) =>
    c.get<{ encode_dir_list?: string[]; library_peer_name?: string | null }>(nodePath(node, '/api/encode/options')),
});
