import { useCallback, useSyncExternalStore } from 'react';

// ミニプレイヤー（元の helpers.jsx の MiniPlayer）。プレイヤーは画面を離れても PlayerHost が描き続け、
// 隠しておくだけにする。ここには「今どのプレイヤーを開いているか」と、下の帯に出す情報と操作が載る

/** 録画・動画の再生画面の指定（/watch/[id] の値。node は開いた時のサーバーで固定する） */
/** local=1: 端末に保存した分を再生する（通信なしでも見られる） */
export interface WatchParams { id: string; kind?: string; node?: string; from?: string; tot?: string; local?: string }
export interface LiveParams { sid: string; onid: string; node?: string }
export type PlayerSession = { kind: 'watch'; params: WatchParams } | { kind: 'live'; params: LiveParams };

/** 下の帯に出すもの。再生中のプレイヤーが publish する */
export interface MiniState {
  kind: 'watch' | 'live';
  title: string;
  episodeNum: string;
  episodeName: string;
  thumb: { uri: string; headers?: Record<string, string> } | null;
  playing: boolean;
  canNext: boolean;
  toggle: () => void;
  next: () => void;
}

/** 今の状態。変わるたびに別の物にする（画面は物が替わったことで描き直す） */
/** pip: 小窓（PiP）で見ている間。帯は出さない（同じ映像が二つ並ぶので） */
export interface MiniSnapshot { session: PlayerSession | null; mini: MiniState | null; time: { current: number; duration: number }; pip: boolean }
let snap: MiniSnapshot = { session: null, mini: null, time: { current: 0, duration: 0 }, pip: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<MiniSnapshot>) => { snap = { ...snap, ...patch }; listeners.forEach((l) => l()); };
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const sameSession = (a: PlayerSession | null, b: PlayerSession | null) => JSON.stringify(a) === JSON.stringify(b);

export const miniPlayer = {
  /** 開くプレイヤーを替える（別の種類に替えると前のものは終わる。null で閉じる） */
  setSession(next: PlayerSession | null) {
    if (sameSession(snap.session, next)) return;
    set(next ? { session: next } : { session: null, mini: null, pip: false });
  },
  get: () => snap.mini,
  /** 小窓が開いた・閉じた（再生中のプレイヤーが知らせる） */
  setPip(on: boolean) { if (snap.pip !== on) set({ pip: on }); },
  publish(s: MiniState) { set({ mini: s }); },
  /** そのプレイヤーが消えた時。別の種類が載っていれば消さない */
  clear(kind: MiniState['kind']) { if (snap.mini?.kind === kind) set({ mini: null }); },
  setTime(current: number, duration: number) {
    // 帯の時刻は秒単位で足りる（毎回描き直さない）
    if (Math.floor(current) === Math.floor(snap.time.current) && duration === snap.time.duration) return;
    set({ time: { current, duration } });
  },
};

/** ミニプレイヤーの今の状態（変わったら描き直す） */
export function useMiniPlayer(): MiniSnapshot {
  const s = useCallback(sub, []);
  return useSyncExternalStore(s, () => snap);
}

/** 帯の高さ（サーバーの設定 mini_player_height。40〜200、既定 64） */
export const miniBarHeight = (v: unknown) => Math.min(MINI_MAX, Math.max(40, Number(v) || 64));
export const MINI_MAX = 200;

/** mini_player_height をこの値（200 より大きい値）にすると、映像を横幅いっぱいに出し、題名とボタンをその下に並べる */
export const MINI_FULL = 999;
export const isMiniFull = (v: unknown) => Number(v) > MINI_MAX;

/**
 * 横に並べる時の映像の大きさと、右の並べ方。帯の高さは映像 +14 に詰める（設定の高さのままだと上下が空く）。
 * - row: 映像の右に題名とボタンを1列（映像は帯の 45% まで。幅 390 で 160px にすると映像だけで埋まり、✕ がはみ出していた）
 * - stack: 映像が 76 以上。右に題名（上）とボタン（下）を縦に積む（右の列はボタン3つ分の幅）
 * - tall: 映像が 110 以上。ボタンを縦1列にし、その左に題名を縦書きで出す（右の列がいちばん細く、映像を大きくできる）
 * 映像が置ける幅を超える時は縮める
 */
export function miniRowThumb(barH: number, boxW: number) {
  const h = barH - 14;
  const w = Math.round((h * 16) / 9);
  const mode: 'row' | 'stack' | 'tall' = h >= 110 ? 'tall' : h >= 76 ? 'stack' : 'row';
  const side = mode === 'tall' ? MINI_TALL_SIDE_W : 124;
  const cap = boxW <= 0 ? w : mode === 'row' ? Math.round(boxW * 0.45) : Math.round(boxW - 20 - 9 - side);
  return { ...(w <= cap ? { w, h } : { w: cap, h: Math.round((cap * 9) / 16) }), mode };
}
/** tall の右の列の幅（縦書きの題名 16 + 間 6 + ボタン 34） */
const MINI_TALL_SIDE_W = 56;

/** 横幅いっぱいの時の映像の幅（PC の広い画面では大きくなりすぎないよう抑える） */
export const miniFullVideoWidth = (boxW: number) => Math.min(480, Math.max(0, boxW));
