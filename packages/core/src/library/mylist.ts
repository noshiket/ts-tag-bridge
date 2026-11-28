import type { ApiClient } from '../http/client';

// マイリストは利用者に紐づくので、他のサーバーを見ている時もこのサーバーへ問い合わせる
// （中継先には利用者が乗らず 401 になる）
export const mylistApi = (c: ApiClient) => ({
  /** 追加が新しい順 */
  ids: async () => (await c.get<{ album_ids: number[] }>('/api/users/me/mylist')).album_ids,
  set: (albumId: number, on: boolean) =>
    on ? c.put<unknown>(`/api/users/me/mylist/${albumId}`) : c.delete<unknown>(`/api/users/me/mylist/${albumId}`),
});
