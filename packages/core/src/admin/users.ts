// 利用者の管理（設定 > アカウント。管理者だけ）。元の Web 版の settings.jsx / user_perms.jsx と同じ決め方。
// 画面・サーバー・放送局は「許可する一覧」、カテゴリだけ「隠す一覧」。判定はサーバー（logic/perms.py）が行う
import type { ApiClient } from '../http/client';
import type { Service } from '../epg/guide';

export type UserStatus = 'approved' | 'pending' | 'rejected';
/** GET /api/admin/users の1件 */
export interface AdminUser { id: number; username: string; is_admin: number | boolean; status: UserStatus | string; created_at?: string }
/** GET /api/admin/users/:id/perms（'*' は全部） */
export interface UserPerms {
  screens: string[]; nodes: string[]; stations: string[]; deny_categories: number[]; can_write: number | boolean; updated_at?: string;
  /** 見られる番組表のアドオン（名前。['*'] で全部）。番組表の画面の許可も要る */
  guides?: string[];
  /** 有料の番組（スクランブル）を見られる・予約できるか */
  paid?: number | boolean;
}
export interface VideoCategory { id: number; name: string }

export const STATUS_LABEL: Record<string, string> = { approved: '承認済み', pending: '承認待ち', rejected: '却下' };

/** 許可できる画面 */
export const PERM_SCREENS: { id: string; label: string }[] = [
  { id: 'epg', label: '番組表' }, { id: 'reservations', label: '予約' }, { id: 'recresult', label: '録画結果' },
  { id: 'library', label: 'ライブラリ' }, { id: 'encode', label: 'エンコード' }, { id: 'live', label: 'ライブ視聴' },
];

/** 局のまとまり。地デジのマルチ編成（QZX総合1/2 など）は同じ局なので1つにまとめる（地デジは onid===tsid） */
export interface StationGroup { key: string; label: string; ids: string[]; nodes: string[]; sub?: number }
export function groupServices(services: (Service & { _node?: string })[]): StationGroup[] {
  const groups: StationGroup[] = [];
  const byKey: Record<string, StationGroup> = {};
  for (const s of services) {
    const key = s.onid === s.tsid ? `t${s.onid}-${s.tsid}` : `s${s.onid}-${s.tsid}-${s.sid}`;
    let g = byKey[key];
    if (!g) { g = byKey[key] = { key, label: s.service_name, ids: [], nodes: [] }; groups.push(g); }
    const id = `${s.onid}-${s.tsid}-${s.sid}`;
    if (!g.ids.includes(id)) g.ids.push(id);
    // 同じ局が複数のサーバーにあれば1つにまとめる（局の番号はサーバーで共通）
    const nd = s._node || '';
    if (!g.nodes.includes(nd)) g.nodes.push(nd);
    if (g.ids.length > 1) g.sub = g.ids.length;
  }
  return groups;
}

/** 局の波（サーバーの logic/perms.py の network_of と同じ決め方）。権限では 'net:GR' などで波ごと許可する */
export type PermNet = 'GR' | 'BS' | 'CS' | 'OTHER';
export const PERM_NETS: PermNet[] = ['GR', 'BS', 'CS', 'OTHER'];
export function networkOf(onid: number | null | undefined): PermNet {
  if (onid == null) return 'OTHER';
  if (onid >= 0x7880 && onid <= 0x7fef) return 'GR';
  if (onid === 4) return 'BS';
  if (onid === 6 || onid === 7 || onid === 10) return 'CS';
  return 'OTHER';
}
/** 局のまとまりが、波ごとの許可に入っているか */
export const groupNetAllowed = (stations: string[], g: StationGroup) =>
  stations.includes(`net:${networkOf(Number(g.ids[0]?.split('-')[0]))}`);

/** 一覧の1つを切り替える（'*' は外して個別にする） */
export function togglePerm<T extends string | number>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list.filter((x) => x !== '*'), v];
}
/** 局のまとまりを切り替える（全部入っていれば外す） */
export function toggleStationGroup(stations: string[], g: StationGroup): string[] {
  const cur = stations.filter((v) => v !== '*');
  return g.ids.every((id) => cur.includes(id)) ? cur.filter((id) => !g.ids.includes(id)) : [...cur, ...g.ids.filter((id) => !cur.includes(id))];
}
/** 保存する中身 */
export const permsBody = (p: UserPerms) => ({
  screens: p.screens ?? [], nodes: p.nodes ?? [], stations: p.stations ?? [], deny_categories: p.deny_categories ?? [], can_write: !!p.can_write,
  guides: p.guides ?? [], paid: !!p.paid,
});

export const adminApi = (c: ApiClient) => ({
  users: () => c.get<AdminUser[]>('/api/admin/users'),
  removeUser: (id: number) => c.delete<unknown>(`/api/admin/users/${id}`),
  setStatus: (id: number, status: UserStatus) => c.patch<Partial<AdminUser>>(`/api/admin/users/${id}/status`, { status }),
  /** 管理者にする・外す（自分自身は変えられない。管理者にできるのは承認済みの利用者だけ） */
  setAdmin: (id: number, isAdmin: boolean) => c.patch<Partial<AdminUser>>(`/api/admin/users/${id}/admin`, { is_admin: isAdmin }),
  perms: (id: number) => c.get<UserPerms>(`/api/admin/users/${id}/perms`),
  savePerms: (id: number, body: ReturnType<typeof permsBody>) => c.patch<UserPerms>(`/api/admin/users/${id}/perms`, body),
  categories: () => c.get<VideoCategory[]>('/api/videos/categories'),
});
