import { ApiError, TimeoutError, UnauthorizedError } from './errors';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  /** JSON にして送る */
  body?: unknown;
  /** 既定の待ち時間を変える（解析など時間のかかる呼び出し） */
  timeoutMs?: number;
}

export interface ClientConfig {
  /** サーバーの起点。Web は同じ場所から配るので ''、アプリは 'https://…:8082' */
  baseUrl: string;
  /** アプリの長期トークン。返せば Bearer で送る。Web は Cookie なので渡さない */
  getToken?: () => string | null;
  /** 401 を受けた（/api/auth/* を除く）。ログイン画面へ戻すのに使う */
  onUnauthorized?: () => void;
  /** 画面が前に出るまで待つ。背面にいる間は取り直さない（Web は visibility、アプリは AppState） */
  waitUntilActive?: () => Promise<void>;
  /** テストで差し替える */
  fetch?: typeof fetch;
  timeouts?: Partial<Timeouts>;
}

export interface Timeouts {
  /** ヘッダが届くまで。届かないサーバーで画面が「読み込み中」のまま止まらないように */
  request: number;
  /** 別サーバー宛（/api/nodes/…）。中継側が 25 秒待つので、それより少し長く */
  node: number;
  /** 本文を読み終えるまで（下限）。大きな応答を遅い回線で受けても切らない */
  body: number;
  /** 通信そのものが失敗した読み込み（GET）を取り直す間隔（秒）。サーバーの再起動（約45秒）を待てる長さ */
  retrySec: number[];
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  request: 8_000,
  node: 28_000,
  body: 30_000,
  retrySec: [1, 2, 3, 5, 8, 13, 20],
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** サーバーの API を呼ぶ。待ち時間・取り直し・401 の扱いをここにまとめる。 */
export class ApiClient {
  private readonly timeouts: Timeouts;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ClientConfig) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.fetchImpl = config.fetch ?? ((...a) => fetch(...a));
  }

  /** 画像・動画など fetch を通さない URL。アプリは画像の読み込みにも authHeaders() を付ける */
  url(path: string): string {
    return this.config.baseUrl + path;
  }

  authHeaders(): Record<string, string> {
    const token = this.config.getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  get<T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) {
    return this.request<T>(path, { ...opts, method: 'GET' });
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>(path, { ...opts, method: 'POST', body });
  }
  put<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>(path, { ...opts, method: 'PUT', body });
  }
  patch<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>(path, { ...opts, method: 'PATCH', body });
  }
  delete<T>(path: string, opts?: RequestOptions) {
    return this.request<T>(path, { ...opts, method: 'DELETE' });
  }

  /**
   * プライベートモード（元の Web 版の setApiPrivateMode）。入っている間は、全部の問い合わせに private=1 を付けて
   * 自分の非公開カテゴリの動画も出させる。ライブラリを開いている間だけ入れる
   */
  privateMode = false;

  async request<T>(rawPath: string, opts: RequestOptions = {}): Promise<T> {
    const path = this.privateMode ? `${rawPath}${rawPath.includes('?') ? '&' : '?'}private=1` : rawPath;
    const method = opts.method ?? 'GET';
    const limit = opts.timeoutMs ?? (path.startsWith('/api/nodes/') ? this.timeouts.node : this.timeouts.request);
    const headers: Record<string, string> = { ...this.authHeaders() };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; ; attempt++) {
      // ヘッダまでと本文までで待ち時間を分けるが、打ち切りは同じ signal で行う
      // （本文の読み込みは fetch の signal でしか止まらない）
      const ctl = new AbortController();
      let timer = setTimeout(() => ctl.abort(), limit);
      let res: Response;
      try {
        res = await this.fetchImpl(this.url(path), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          credentials: 'include',
          signal: ctl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (ctl.signal.aborted) throw new TimeoutError(path);
        // 取り直すのは、通信そのものが失敗した読み込みだけ。書き込みは二重に効くことがある
        const delay = this.timeouts.retrySec[attempt];
        if (method !== 'GET' || !(e instanceof TypeError) || delay === undefined) throw e;
        await sleep(delay * 1000);
        await this.config.waitUntilActive?.();
        continue;
      }
      clearTimeout(timer);
      // 本文にも上限を掛ける。背面で止められた通信が本文の途中で固まると、
      // 取得が終わらないまま残り、戻っても一覧が出なかった
      timer = setTimeout(() => ctl.abort(), Math.max(limit, this.timeouts.body));
      try {
        return await this.read<T>(path, res);
      } catch (e) {
        if (ctl.signal.aborted) throw new TimeoutError(path);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async read<T>(path: string, res: Response): Promise<T> {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      this.config.onUnauthorized?.();
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, err?.error || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }
}
