import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError, TimeoutError, UnauthorizedError } from '../src';

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 呼ばれた URL と設定を控えつつ、順に答えを返す fetch */
function fakeFetch(...answers: Array<Response | Error | ((signal: AbortSignal) => Promise<Response>)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return a(init.signal!);
    if (!a) throw new Error('答えを用意していない呼び出し');
    return a;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const fast = { request: 40, node: 80, body: 60, retrySec: [0, 0] };

/** signal で止められるまで答えない */
const hang = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

describe('ApiClient', () => {
  it('起点を付けて呼び、JSON を返す。Bearer は getToken がある時だけ', async () => {
    const f = fakeFetch(json({ ok: 1 }), json({ ok: 2 }));
    const withToken = new ApiClient({ baseUrl: 'https://s', getToken: () => 'T', fetch: f.impl });
    expect(await withToken.get('/api/x')).toEqual({ ok: 1 });
    expect(f.calls[0]!.url).toBe('https://s/api/x');
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer T');

    const web = new ApiClient({ baseUrl: '', fetch: f.impl });
    await web.get('/api/x');
    expect((f.calls[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(f.calls[1]!.init.credentials).toBe('include');
  });

  it('本文は JSON にして送る', async () => {
    const f = fakeFetch(json({}));
    await new ApiClient({ baseUrl: '', fetch: f.impl }).post('/api/x', { a: 1 });
    expect(f.calls[0]!.init.body).toBe('{"a":1}');
    expect((f.calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('204 は null', async () => {
    const f = fakeFetch(json(null, 204));
    expect(await new ApiClient({ baseUrl: '', fetch: f.impl }).delete('/api/x')).toBeNull();
  });

  it('失敗はサーバーの error 欄を message にする', async () => {
    const f = fakeFetch(json({ error: 'だめ' }, 400), new Response('x', { status: 502 }));
    const c = new ApiClient({ baseUrl: '', fetch: f.impl });
    await expect(c.get('/api/x')).rejects.toMatchObject({ status: 400, message: 'だめ' });
    await expect(c.get('/api/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('401 はログイン切れとして知らせる。ログインの API 自体の 401 は知らせない', async () => {
    const onUnauthorized = vi.fn();
    const f = fakeFetch(json({}, 401), json({ error: '違います' }, 401));
    const c = new ApiClient({ baseUrl: '', fetch: f.impl, onUnauthorized });
    await expect(c.get('/api/videos/albums')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(c.post('/api/auth/login', {})).rejects.toMatchObject({ message: '違います' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('通信そのものが失敗した読み込みは取り直す', async () => {
    const f = fakeFetch(new TypeError('Load failed'), new TypeError('Load failed'), json({ ok: 1 }));
    const waitUntilActive = vi.fn(async () => {});
    const c = new ApiClient({ baseUrl: '', fetch: f.impl, timeouts: fast, waitUntilActive });
    expect(await c.get('/api/x')).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(3);
    expect(waitUntilActive).toHaveBeenCalledTimes(2);
  });

  it('取り直しは決めた回数まで。書き込みは取り直さない', async () => {
    const f = fakeFetch(new TypeError('a'), new TypeError('b'), new TypeError('c'), new TypeError('d'));
    const c = new ApiClient({ baseUrl: '', fetch: f.impl, timeouts: fast });
    await expect(c.get('/api/x')).rejects.toThrow('c');
    await expect(c.post('/api/x')).rejects.toThrow('d');
    expect(f.calls).toHaveLength(4);
  });

  it('ヘッダが来なければ打ち切る。別サーバー宛は長く待つ', async () => {
    const f = fakeFetch(hang, hang);
    const c = new ApiClient({ baseUrl: '', fetch: f.impl, timeouts: fast });
    let t = Date.now();
    await expect(c.get('/api/x')).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t).toBeLessThan(fast.node);
    t = Date.now();
    await expect(c.get('/api/nodes/b/x')).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t).toBeGreaterThanOrEqual(fast.node - 5);
  });

  it('本文の途中で止まった応答も打ち切る（読み込み中のまま残らない）', async () => {
    const stalled = (signal: AbortSignal) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(ctl) {
              ctl.enqueue(new TextEncoder().encode('{"a":'));
              signal.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
            },
          }),
          { status: 200 },
        ),
      );
    const f = fakeFetch(stalled);
    const c = new ApiClient({ baseUrl: '', fetch: f.impl, timeouts: fast });
    await expect(c.get('/api/x')).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('プライベートモード', () => {
  it('入っている間は全部の問い合わせに private=1', async () => {
    const { ApiClient } = await import('../src');
    const urls: string[] = [];
    const c = new ApiClient({ baseUrl: 'https://h', fetch: (async (u: string) => { urls.push(u); return new Response('{}', { status: 200 }); }) as never });
    await c.get('/api/a');
    c.privateMode = true;
    await c.get('/api/b');
    await c.get('/api/c?x=1');
    expect(urls).toEqual(['https://h/api/a', 'https://h/api/b?private=1', 'https://h/api/c?x=1&private=1']);
  });
});
