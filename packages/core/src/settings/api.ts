// サーバーの設定（設定画面の管理者のタブ）
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { AddonDraft, AddonSetting } from './addons';
import type { ApiRoute } from './apiDocs';
import type { AudioJob, LogEntry } from './config';
import type { LogoEntry } from './logos';

/** GET /api/storage の1件（EDCB の録画先）。EDCB から配列が取れなかった時は、その応答をそのまま返してくる */
export interface StorageInfo { id: string; name: string; text: string; total: number | string; free: number; avail?: number }

/** 使っている割合（0〜1） */
export function storageUsed(s: StorageInfo): number {
  const total = parseInt(String(s.total), 10) || 1;
  return (total - s.free) / total;
}

export const settingsApi = (c: ApiClient) => ({
  /** そのサーバーの API の一覧（開発者向けの説明の画面。管理者だけ） */
  apiRoutes: (node?: string | null) => c.get<{ routes: ApiRoute[] }>(nodePath(node, '/api/docs/routes')),
  storage: (node?: string | null) => c.get<StorageInfo[] | unknown>(nodePath(node, '/api/storage')),
  /** サーバーの設定（秘密の値は伏せてある） */
  config: (node?: string | null) => c.get<Record<string, unknown>>(nodePath(node, '/api/config')),
  /** EPG をすぐ取りに行く（EDCB の epg_cap_now） */
  epgCap: (node?: string | null) => c.post<{ info?: string }>(nodePath(node, '/api/edcb/epg_cap'), {}),
  /** EPG を読み直す（EDCB の reload_epg） */
  reloadEpg: (node?: string | null) => c.post<{ info?: string }>(nodePath(node, '/api/edcb/reload_epg'), {}),
  /** 設定を変える（変えた項目だけ。再起動が要るかと、変わった項目を返す） */
  saveConfig: (body: Record<string, unknown>, node?: string | null) =>
    c.patch<{ restart_required?: boolean; changed?: string[] }>(nodePath(node, '/api/config'), body),
  /** 画面で起きた失敗をサーバーのログへ残す（画面に理由が出ないものの切り分け用。元の reportClientError） */
  clientError: (message: string, context: Record<string, unknown> = {}) =>
    c.post<unknown>('/api/logs/client', { message: String(message || ''), context }),
  restart: (node?: string | null) => c.post<unknown>(nodePath(node, '/api/config/restart'), {}),
  /** 再起動の前の確かめ: いま動いているエンコードと録画の取り込みの件数 */
  restartBusy: (node?: string | null) => c.get<{ encoding: number; scanning: number }>(nodePath(node, '/api/config/restart/busy')),
  /** 動いているか（再起動を待つ時に見る） */
  status: (node?: string | null) => c.get<unknown>(nodePath(node, '/api/status')),
  testConnection: (body: { type: string; url?: unknown; fed_token?: unknown; verify_tls?: boolean }, node?: string | null) =>
    c.post<{ ok: boolean; detail?: string; error?: string }>(nodePath(node, '/api/config/test_connection'), body),
  generateSecret: (node?: string | null) => c.post<{ value: string }>(nodePath(node, '/api/config/generate_secret'), {}),
  diskStatus: (paths: string[], node?: string | null) =>
    c.post<{ path: string; mounted: boolean; free?: number; total?: number }[]>(nodePath(node, '/api/config/disk_status'), { paths }),
  /** パターンを全部ピアへ送り直す */
  syncAllPatterns: (node?: string | null) =>
    c.post<Record<string, { ok: boolean; sids: number; error?: string }>>(nodePath(node, '/api/patterns/sync_all'), {}),
  logs: (level: string | null, node?: string | null) =>
    c.get<LogEntry[]>(nodePath(node, `/api/logs?limit=500${level ? `&level=${encodeURIComponent(level)}` : ''}`)),
  /** 音声解析の順番待ち（このサーバーだけ） */
  audioQueue: () => c.get<{ jobs?: AudioJob[] }>('/api/audio-compare/queue'),
  cancelAudioJob: (id: string) => c.post<unknown>(`/api/audio-compare/queue/${id}/cancel`),
  addons: (node?: string | null) => c.get<AddonSetting[]>(nodePath(node, '/api/addons/settings')),
  saveAddon: (name: string, body: AddonDraft, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/addons/${encodeURIComponent(name)}/settings`), body),
  /** 足りない追加ライブラリを入れる */
  installAddonRequirements: (name: string, node?: string | null) =>
    c.post<{ ok: boolean; log?: string }>(nodePath(node, `/api/addons/${encodeURIComponent(name)}/install`)),
  logoList: (node?: string | null) => c.get<LogoEntry[]>(nodePath(node, '/api/logo/list')),
  /** EDCB が保存したロゴを取り込む */
  fetchEdcbLogos: (node?: string | null) =>
    c.post<{ saved: unknown[]; skipped: unknown[]; errors: unknown[] }>(nodePath(node, '/api/logo/fetch_edcb'), {}),
  clearLogoCache: (node?: string | null) => c.post<{ cleared: number }>(nodePath(node, '/api/logo/cache/clear'), {}),
  /** 試しに動かす */
  fireAddon: (name: string, node?: string | null) =>
    c.post<{ ok: boolean; result?: unknown; error?: string }>(nodePath(node, `/api/addons/${encodeURIComponent(name)}/fire`), {}),
});
