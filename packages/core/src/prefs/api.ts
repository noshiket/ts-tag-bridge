import type { ApiClient } from '../http/client';

/** 見た目などの好み。アカウントに保存され、どの端末でも同じになる（元の Web 版の tweaks） */
export interface Tweaks {
  theme?: string;
  accent?: string;
  /** 一覧の1ページの件数 */
  pageSize?: number;
  [key: string]: unknown;
}

/** GET /api/users/me/prefs */
export interface Prefs {
  tweaks: Tweaks;
  /** プライベートモードで出す非公開カテゴリ */
  private_categories: string[];
  [key: string]: unknown;
}

/**
 * 書き換える中身。サーバーは tweaks を丸ごと置き換える（混ぜない）ので、今の tweaks に重ねた全体を送る。
 * 一部だけ送ると他の好み（テーマ・色など）が消える
 */
export function prefsPatchBody(current: Prefs, body: Partial<Prefs>): Partial<Prefs> {
  return body.tweaks ? { ...body, tweaks: { ...current.tweaks, ...body.tweaks } } : body;
}

export const prefsApi = (c: ApiClient) => ({
  get: () => c.get<Prefs>('/api/users/me/prefs'),
  /** 渡した欄を置き換える（tweaks も丸ごと。prefsPatchBody で全体にしてから渡す）。応答は書き換えた後の全体 */
  patch: (body: Partial<Prefs>) => c.patch<Prefs>('/api/users/me/prefs', body),
  /** 入力欄の履歴（欄ごと・新しい順）。アカウントに保存され、どの端末でも同じ候補が出る */
  inputHistory: () => c.get<Record<string, string[]>>('/api/users/me/input_history'),
  /** 1つの欄の履歴を変える（足す・消す・端末に残っていた分を混ぜる）。応答は変えた後の一覧 */
  changeInputHistory: (body: { key: string; push?: string; remove?: string; merge?: string[] }) =>
    c.post<{ key: string; items: string[] }>('/api/users/me/input_history', body),
});
