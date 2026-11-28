import type { ApiClient } from '../http/client';

/** 画面の出し分けに使うアクセス権（判定の本体はサーバー側） */
export interface Perms {
  is_admin: boolean;
  can_write: boolean;
  screens: string[];
  nodes: string[];
  stations: string[];
  deny_categories: string[];
}

export interface Me {
  id: number;
  username: string;
  is_admin: boolean | number;
  perms: Perms;
}

/** POST /api/auth/register。最初の1人は管理者としてすぐ使える。2人目からは承認待ち */
export interface Registered {
  id: number;
  username: string;
  status: 'approved' | 'pending';
  message?: string;
}

export interface AppToken {
  token: string;
  name: string;
}

export const authApi = (c: ApiClient) => ({
  /** Web は応答の Cookie でログインできる。アプリはこのあと appToken() で長期トークンに替える */
  login: (username: string, password: string) => c.post<Me>('/api/auth/login', { username, password }),
  register: (username: string, password: string) => c.post<Registered>('/api/auth/register', { username, password }),
  logout: () => c.post<{ ok: boolean }>('/api/auth/logout'),
  me: () => c.get<Me>('/api/auth/me'),
  /** 端末ごとの長期トークンを発行する。生の値を受け取れるのはこの応答だけ */
  issueAppToken: (deviceName: string) => c.post<AppToken>('/api/app/tokens', { name: deviceName }),
});

/** 下のタブ（元の Web 版の画面の名前） */
export type ScreenId = 'epg' | 'reservations' | 'recresult' | 'library' | 'settings';

/** その画面を開けるか（元の canScreen と同じ: 設定は誰でも、管理者は全部、他は許された画面だけ） */
export function canScreen(me: Me | null | undefined, id: ScreenId): boolean {
  if (!me) return false;
  if (id === 'settings') return true;
  const p = me.perms;
  if (!p || me.is_admin || p.is_admin) return true;
  return p.screens.includes('*') || p.screens.includes(id);
}
