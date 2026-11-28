import { parseLocalKey, type LocalSaveMeta, type Api as TSTagApi } from '@tstag/core';
import { AppState, Platform } from 'react-native';

import { backend } from './backend';
import { fetchExtras } from './extras';
import { getSnap, setActive, setSnap } from './snapshot';
import { appLog } from '../lifecycle/appLog';
import { isIOSBrowser } from '../device/iosBrowser';

// 保存の待ち行列: 1本ずつ順に取り、進み具合を持つ。通信が切れたら書けた分を残して、前に出ていて通信がある時に続きを取る。
// 保存先は端末ごと（backend.ios.ts = iOS、backend.ts = Web）

type Pending = { id: number; node: string | null; meta: LocalSaveMeta; secondary: boolean };
const pending = new Map<string, Pending>();
const queue: string[] = [];
const aborters = new Map<string, AbortController>();
const waitingResume = new Set<string>();
let running = false;
let apiRef: TSTagApi | null = null;

/** サーバーへの口を控える（起動時に書きかけの続きを取るため。最初の1回だけ） */
export const rememberApi = (api: TSTagApi, force = false) => { if (force || !apiRef) apiRef = api; };
/** 待っている・取っている分の控え（一覧に出すため） */
export const pendingMeta = (ck: string) => pending.get(ck)?.meta;

/** シークバーのサムネ: iOS は幅の広い旧い画像を読めないので、自サーバーの分は詰め直した画像を保存する（再生画面と同じ決め方） */
// iOS は幅の広い旧いタイル画像を読めないので、列を詰め直した画像にする（アプリも、iPhone・iPad の Safari も）
export const tileReflowed = (node: string | null) => (Platform.OS !== 'web' || isIOSBrowser) && !node;

let loading: Promise<void> | null = null;
/** 保存済みの一覧を読む（1回だけ）。読めたら前の起動の書きかけを続ける */
export function loadIndex() {
  if (!loading) {
    loading = (backend.available() ? backend.loadIndex() : Promise.resolve({}))
      .then((index) => { setSnap({ ready: true, index }); void resumeLeftovers(); })
      .catch(() => setSnap({ ready: true }));
  }
  return loading;
}

async function runOne(api: TSTagApi, ck: string) {
  const p = pending.get(ck);
  if (!p) return;
  const ctl = new AbortController();
  aborters.set(ck, ctl);
  setActive(ck, { status: 'downloading', progress: 0 });
  try {
    const headers = api.client.authHeaders();
    let last = 0;
    const { totalSize } = await backend.writeVideo(ck, api.localSave.downloadUrl(p.id, p.node, p.secondary), headers, p.meta.mime || 'video/mp4',
      (pr) => { if (pr - last >= 0.005 || pr >= 1) { last = pr; setActive(ck, { status: 'downloading', progress: pr }); } }, ctl.signal,
      { meta: p.meta, secondary: p.secondary },
      // 裏で一緒に流した分は、前に戻ると部品が1本に絞って他を待たせる
      (waiting) => setActive(ck, { status: waiting ? 'queued' : 'downloading', progress: last }));
    if (ctl.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const sidecar = await api.localSave.sidecar(p.id, p.node);
    const cachedAt = new Date().toISOString();
    const audio = p.secondary ? 'secondary' as const : 'main' as const;
    const isAudio = sidecar.metadata?.media_kind === 'audio';
    await backend.commit(ck, { sidecar, mime: p.meta.mime || 'video/mp4', totalSize, cachedAt, audio }, p.meta,
      { poster: api.localSave.posterUrl(p.id, p.node), tile: isAudio ? null : api.stream.thumbnailTileUrl(p.id, p.node, tileReflowed(p.node)) }, headers);
    await fetchExtras(api, ck, p.id, p.node);
    // 副音声版はサーバーが作った一時ファイル。取り終えたら片付けてもらう（数百MB〜数GBある）
    if (p.secondary) void api.localSave.deleteSecondary(p.id, p.node);
    pending.delete(ck);
    setSnap({ index: { ...getSnap().index, [ck]: { ...p.meta, cachedAt, audio } } });
    setActive(ck, null);
  } catch (e) {
    if (ctl.signal.aborted) { pending.delete(ck); setActive(ck, null); await backend.remove(ck).catch(() => {}); return; }
    // 書けた分を残した: 前に出ていて通信があれば少しして続きを取る（元と同じ）
    const partial = (e as { partial?: number }).partial;
    if (partial != null) { scheduleResume(ck, partial); return; }
    setActive(ck, { status: 'error', progress: 0, error: e instanceof Error ? e.message : String(e) });
    // 失敗の表示は少しで消す（もう一度保存できるように。元と同じ）
    setTimeout(() => { if (getSnap().states[ck]?.status === 'error') { pending.delete(ck); setActive(ck, null); } }, 5000);
  } finally {
    aborters.delete(ck);
  }
}

// 通信が切れた保存を続きから取る。前に出ていて通信がある時に積み直す（裏にいる間は動けない）
function scheduleResume(ck: string, progress: number) {
  setActive(ck, { status: 'queued', progress });
  waitingResume.add(ck);
  setTimeout(resumeWaiting, 3000);
}
function resumeWaiting() {
  if (AppState.currentState !== 'active') return;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  for (const ck of [...waitingResume]) {
    waitingResume.delete(ck);
    if (!queue.includes(ck)) queue.push(ck);
  }
  void pump();
}
AppState.addEventListener('change', (st) => {
  if (st === 'active') resumeWaiting();
  // 裏へ回る時は、待っている分も今すぐ全部 iOS の裏の転送に渡す（裏では JS が止まり、1本終わっても次を始められないため）。
  // 取り終えた分は前に戻った時に確定する。前に戻ったら、部品が頼まれた順の1本に絞って他を待たせる
  if (st === 'background' && Platform.OS === 'ios' && apiRef) {
    const api = apiRef;
    let n = 0;
    while (queue.length) { const ck = queue.shift()!; if (pending.has(ck)) { n++; void runOne(api, ck); } }
    if (n) appLog(`[保存] 裏へ回るので待っていた ${n} 本も裏の転送に渡した`);
  }
});
if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', resumeWaiting);
/** 前回の起動で書きかけのまま終わった保存を続ける（待ち行列ごと消えるため。元と同じ） */
async function resumeLeftovers() {
  const left = await backend.listPartial().catch(() => []);
  if (left.length) appLog(`[保存] 前の起動で終わらなかった ${left.length} 本を取り直す`);
  const s = getSnap();
  for (const p of left) {
    if (s.states[p.ck] || s.index[p.ck]) continue;
    const { id, node } = parseLocalKey(p.ck);
    pending.set(p.ck, { id, node, meta: p.meta, secondary: p.secondary });
    scheduleResume(p.ck, p.progress);
  }
}

async function pump() {
  if (running || !apiRef) return;
  running = true;
  try {
    while (queue.length) {
      const ck = queue.shift()!;
      if (pending.has(ck)) await runOne(apiRef, ck);
    }
  } finally { running = false; }
}

/** 積む（1本ずつ順に取る） */
export function enqueue(ck: string, p: Pending) {
  pending.set(ck, p);
  setActive(ck, { status: 'queued', progress: 0 });
  queue.push(ck);
  void pump();
}
/** 待ち・取り中をやめる。取っている途中なら止める（true を返す。後片付けは runOne がする） */
export function dequeue(ck: string) {
  const qi = queue.indexOf(ck);
  if (qi >= 0) queue.splice(qi, 1);
  pending.delete(ck);
  waitingResume.delete(ck);
  const ctl = aborters.get(ck);
  if (ctl) { ctl.abort(); return true; }
  return false;
}
/** 全部やめる（全部消す時） */
export function abortAll() {
  for (const ck of [...aborters.keys()]) aborters.get(ck)?.abort();
  queue.length = 0;
  pending.clear();
}
