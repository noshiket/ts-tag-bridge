import { nodePath } from '../http/node';
import type { ApiClient } from '../http/client';
import type { AnalyzeItem, Pattern, ServerParse } from './parse';
import type { ActionDef } from './actions';
import type { ServerMatch } from './builder';

/** しょぼいカレンダーの作品（題名検索） */
export interface ShoboiTitleHit { tid: number; title?: string; short_title?: string; title_yomi?: string; title_en?: string; first_year?: number | string }
/** しょぼいカレンダーの放送（SID + 時刻） */
export interface ShoboiProgram extends ShoboiTitleHit { pid?: number; count?: number; episode_str?: string; subtitle?: string; start_time?: string; wiki_title?: string; wiki_url?: string }
/** アドオンの予行検索の結果1件（文字を取ってくるアクションの候補） */
export interface AddonSearchHit { subtitle?: string; series_title?: string; broadcast_label?: string; broadcaster?: string }

/** 保存する1件。AND条件は pattern2/text2 */
export interface PatternBody { pattern: string; analyze: AnalyzeItem[]; pattern2?: string; text2?: string }
/** 他のサーバーへの写し（federation）。'ok' 以外は失敗 */
export type PeerSync = { peer_sync?: Record<string, string> };

/** 解析は時間がかかることがある（元と同じ 60 秒） */
const PARSE_TIMEOUT_MS = 60_000;

export const patternsApi = (c: ApiClient) => ({
  /** その局(SID)のパターン（node を渡すとそのサーバーの。省略はこのサーバー） */
  list: (sid: number, node?: string | null) => c.get<Pattern[]>(nodePath(node, `/api/patterns?sid=${sid}`)),
  /** サーバーの text_parser で解析した、実際に採用される結果（node を渡すとそのサーバーで解析する） */
  preview: (context: Record<string, unknown>, analyzers: Pattern[], node?: string | null) =>
    c.post<ServerParse>(nodePath(node, '/api/patterns/preview'), { context, analyzers }, { timeoutMs: PARSE_TIMEOUT_MS }),
  add: (sid: number, body: PatternBody) => c.post<PeerSync>(`/api/patterns?sid=${sid}`, body),
  update: (sid: number, index: number, body: PatternBody) => c.put<PeerSync>(`/api/patterns/${index}?sid=${sid}`, body),
  /** pattern を添えると、番号がずれていてもサーバーがその物を探して消す（ずれたまま別の物を消さない） */
  remove: (sid: number, index: number, target: { pattern: string; pattern2?: string }) =>
    c.delete<PeerSync>(`/api/patterns/${index}?sid=${sid}&pattern=${encodeURIComponent(target.pattern)}&pattern2=${encodeURIComponent(target.pattern2 ?? '')}`),
  /** アクションを試しに当てる（保存しない） */
  testAnalyze: (body: { analyze: unknown[]; pattern: string; text: string; context: Record<string, unknown>; pattern2?: string; text2?: string }) =>
    c.post<{ result?: Record<string, unknown> }>('/api/patterns/test_analyze', body, { timeoutMs: PARSE_TIMEOUT_MS }),
  /** 完全マッチ（サーバーの正規化・正規表現で判定） */
  matches: (context: Record<string, unknown>, analyzers: Pattern[]) =>
    c.post<{ matches?: ServerMatch[]; adopted_index?: number | null }>('/api/patterns/matches', { context, analyzers }),
  /** アクションの定義と出力フィールド（無ければ空。画面は ACTION_SCHEMA へ戻す） */
  actives: async () => {
    const d = await c.get<{ actives?: ActionDef[]; output_fields?: { key: string }[] }>('/api/patterns/actives');
    return { actives: d.actives ?? [], outputFields: (d.output_fields ?? []).map((f) => f.key) };
  },
  /** アドオンの予行検索（文字を取ってくるアクションの候補。sid があれば放送局で絞る） */
  addonSearch: (addon: string, text: string, sid?: number | null) =>
    c.get<AddonSearchHit[]>(`/api/addons/${encodeURIComponent(addon)}/search?${new URLSearchParams({ text, ...(sid != null ? { sid: String(sid) } : {}) })}`),
  /** しょぼいカレンダー（サーバー経由。アクセスの間隔・キャッシュはサーバーが守る） */
  shoboiSearch: (q: string) => c.get<ShoboiTitleHit[]>(`/api/shoboi/search?q=${encodeURIComponent(q)}`),
  shoboiPrograms: (sid: number, startTime: string) =>
    c.get<{ programs?: ShoboiProgram[] }>(`/api/shoboi/programs?${new URLSearchParams({ sid: String(sid), start_time: startTime })}`),
  shoboiTitle: (tid: number | string) => c.get<{ wiki_title?: string; wiki_url?: string }>(`/api/shoboi/title?tid=${encodeURIComponent(String(tid))}`),
  /** 照合と同じそろえ方（全角半角など）にした文字 */
  normalize: async (texts: Record<string, string>, node?: string | null) =>
    (await c.post<{ texts?: Record<string, string> }>(nodePath(node, '/api/patterns/normalize'), { texts })).texts ?? {},
});
