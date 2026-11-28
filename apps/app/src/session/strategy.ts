// Web 版のログイン: サーバーと同じ場所から配るので、ログインの応答の Cookie だけで足りる。
// トークンはページ側に持たない（Cookie は httponly）。
import { createApi } from '@tstag/core';

import type { Saved } from './types';

const api = createApi({ baseUrl: '' });
const WEB: Saved = { serverUrl: '', token: null };

export const needsServerUrl = false;
/** Web は配った場所がサーバー */
export const lastServerUrl = (): string => '';

export async function restore(): Promise<Saved | null> {
  try {
    await api.auth.me();
    return WEB;
  } catch {
    return null;
  }
}

export async function signIn(_serverUrl: string, username: string, password: string): Promise<Saved> {
  await api.auth.login(username, password);
  return WEB;
}

export async function register(_serverUrl: string, username: string, password: string): Promise<Saved | { pending: string }> {
  const r = await api.auth.register(username, password);
  if (r.status !== 'approved') return { pending: r.message || '' };  // 空なら画面が「承認をお待ちください」を出す
  return WEB;
}

/** Web は Cookie でログインするので、トークンを渡すログインは無い */
export async function adopt(_serverUrl?: string, _token?: string): Promise<Saved> {
  throw new Error('Web 版では使えません');
}

export async function forget(): Promise<void> {
  await api.auth.logout().catch(() => {});
}
