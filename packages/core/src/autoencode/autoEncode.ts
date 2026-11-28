// 自動エンコードのルール（確定値が一致した録画を、録画が終わったら自動でエンコードのキューへ入れる）。
// 元の Web 版の detail.jsx の AutoEncodeRegister と同じ決め方
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';

/** GET /api/auto_encode の1件 */
export interface AutoEncodeRule {
  id: number;
  enabled: number | boolean;
  folder: string | null;
  title: string | null;
  sid: number | null;
  use_folder: number | boolean;
  use_title: number | boolean;
  use_sid: number | boolean;
  require_episode_name: number | boolean;
  require_episode_number: number | boolean;
  allow_multi_episode: number | boolean;
}

export interface AutoEncodeFlags {
  use_folder: boolean;
  use_title: boolean;
  use_sid: boolean;
  require_episode_name: boolean;
  require_episode_number: boolean;
  allow_multi_episode: boolean;
}

/** 登録の既定（元と同じ: title と sid が一致し、話数がある時） */
export const DEFAULT_AUTO_ENCODE_FLAGS: AutoEncodeFlags = {
  use_folder: false, use_title: true, use_sid: true, require_episode_name: false, require_episode_number: true, allow_multi_episode: false,
};

/** 確定値の比べ方（複数話の並びは ', ' でつなぐ） */
export const aeNorm = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

/** そのルールの一致の条件がすべてこの録画（予約）と合うか＝もう登録してあるか（話数などの条件は見ない） */
export function ruleTargets(rule: AutoEncodeRule, confirmed: Record<string, unknown> | null, sid: number | string | null): boolean {
  const c = confirmed || {};
  let any = false;
  if (rule.use_folder) { any = true; if (aeNorm(c.folder) !== aeNorm(rule.folder)) return false; }
  if (rule.use_title) { any = true; if (aeNorm(c.title) !== aeNorm(rule.title)) return false; }
  if (rule.use_sid) { any = true; if (String(sid ?? '') !== String(rule.sid ?? '')) return false; }
  return any;
}

export function summarizeRule(rule: AutoEncodeRule): string[] {
  return [
    rule.use_folder && 'folder一致', rule.use_title && 'title一致', rule.use_sid && 'sid一致',
    rule.require_episode_name && 'ep_name必須', rule.require_episode_number && 'ep_num必須', rule.allow_multi_episode && '複数話可',
  ].filter((x): x is string => !!x);
}

/**
 * 登録の中身。録画（DB にある）はサーバーが確定値を写し取るので番号だけ、
 * 予約はまだ DB に無いので確定値を書いて渡す
 */
export function autoEncodeBody(dbRecId: number | null, confirmed: Record<string, unknown> | null, sid: number | null, flags: AutoEncodeFlags) {
  if (dbRecId != null) return { recording_id: dbRecId, ...flags };
  const c = confirmed || {};
  return { folder: aeNorm(c.folder) || null, title: aeNorm(c.title) || null, sid: sid != null && Number.isFinite(Number(sid)) ? Number(sid) : null, ...flags };
}

export const autoEncodeApi = (c: ApiClient) => ({
  list: (node?: string | null) => c.get<AutoEncodeRule[]>(nodePath(node, '/api/auto_encode')),
  add: (body: Record<string, unknown>, node?: string | null) => c.post<unknown>(nodePath(node, '/api/auto_encode'), body),
  remove: (id: number, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/auto_encode/${id}`)),
});
