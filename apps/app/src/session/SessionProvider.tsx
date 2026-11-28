import { createApi, type Api } from '@tstag/core';
import { ApiProvider } from '@tstag/core/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { waitUntilActive } from '../lib/lifecycle/waitUntilActive';
import { clearOffline } from '../lib/device/offlineCache';
import * as strategy from './strategy';
import type { Saved } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface Session {
  status: Status;
  /** アプリはログイン画面でサーバーの URL を入れる。Web は同じ場所なので要らない */
  needsServerUrl: boolean;
  /** 今入っているサーバー（アプリ。Web は空） */
  serverUrl: string;
  /** 最後に入ったサーバー（ログアウトしても残る。ログイン画面に入れておく） */
  lastServerUrl: () => string;
  signIn: (serverUrl: string, username: string, password: string) => Promise<void>;
  /** 承認待ちなら案内の文を返す（まだログインしない） */
  register: (serverUrl: string, username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionProvider の外で useSession を呼んでいます');
  return s;
}

/** ログインの状態と、その状態で使う API・取得結果の置き場をまとめて配る */
export function SessionProvider({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  // API は token を呼ぶたびに読む。作り直すと取得中のものが古い token のまま残る
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = saved?.token ?? null;

  const dropSession = useCallback(() => {
    setSaved(null);
    setStatus('signedOut');
    clearOffline();
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    strategy.restore().then(async (s) => {
      // 開発ビルドの確認用: Metro を EXPO_PUBLIC_DEV_SERVER / EXPO_PUBLIC_DEV_TOKEN 付きで動かすと、
      // パスワードを打たずにそのトークンで入る（シミュレータは画面を押せないため）。
      // 配布するビルドでは __DEV__ が false なので通らない。ログイン済みなら使わない（実機の Debug ビルドが
      // このトークン付きの Metro から読むと、起動のたびに利用者のログインを上書きし、通らずにログアウトしていた）
      const devServer = process.env.EXPO_PUBLIC_DEV_SERVER;
      const devToken = process.env.EXPO_PUBLIC_DEV_TOKEN;
      if (__DEV__ && devServer && devToken && !s) {
        s = await strategy.adopt(devServer, devToken).catch(() => s);
      }
      setSaved(s);
      setStatus(s ? 'signedIn' : 'signedOut');
    });
  }, []);

  const api: Api = useMemo(
    () =>
      createApi({
        baseUrl: saved?.serverUrl ?? '',
        getToken: () => tokenRef.current,
        waitUntilActive,
        // トークンが失効した・Cookie が切れた。ログイン画面へ戻す
        onUnauthorized: () => {
          strategy.forget();
          dropSession();
        },
      }),
    [saved?.serverUrl, dropSession],
  );

  const session: Session = useMemo(
    () => ({
      status,
      needsServerUrl: strategy.needsServerUrl,
      serverUrl: saved?.serverUrl ?? '',
      lastServerUrl: strategy.lastServerUrl,
      signIn: async (serverUrl, username, password) => {
        const s = await strategy.signIn(serverUrl, username, password);
        queryClient.clear();
        setSaved(s);
        setStatus('signedIn');
      },
      register: async (serverUrl, username, password) => {
        const r = await strategy.register(serverUrl, username, password);
        if ('pending' in r) return r.pending;
        queryClient.clear();
        setSaved(r);
        setStatus('signedIn');
        return null;
      },
      signOut: async () => {
        await strategy.forget();
        dropSession();
      },
    }),
    [status, saved?.serverUrl, queryClient, dropSession],
  );

  return (
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>{children}</ApiProvider>
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}
