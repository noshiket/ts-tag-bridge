import type { ApiClient } from '../http/client';

/**
 * 表示言語。アプリの文字は日本語の辞書（ja.ts の JA）を元に「キー → 文」で引く。
 * 他の言語はサーバーの言語アドオン（target='language'）が辞書を返し、訳の無いキーは日本語で出す。
 * 文の中の {n} などは vars で埋める。単数と複数で変わる言語は {one, other} で書き、vars.n が 1 なら one
 */
export type Message = string | { one?: string; other: string };
export type Messages = Record<string, Message>;
export type Vars = Record<string, unknown>;

export function formatMessage(msg: Message, vars?: Vars): string {
  const text = typeof msg === 'string' ? msg : (Number(vars?.n) === 1 && msg.one) || msg.other;
  return vars ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : text;
}

/** dict（その言語の辞書）に無ければ base（日本語）で */
export function translate(base: Messages, dict: Messages | null | undefined, key: string, vars?: Vars): string {
  const msg = dict?.[key] ?? base[key];
  return msg === undefined ? key : formatMessage(msg, vars);
}

export interface Language { code: string; label: string; description: string; name: string }

export const i18nApi = (c: ApiClient) => ({
  /** 選べる表示言語（日本語は本体が持つので含まない） */
  languages: () => c.get<Language[]>('/api/i18n/languages'),
  /** その言語の辞書 */
  messages: (code: string) => c.get<{ code: string; label: string; messages: Messages }>(`/api/i18n/${encodeURIComponent(code)}`),
});
