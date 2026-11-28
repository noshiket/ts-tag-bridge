import type { MsgKey } from '@tstag/core';
// 再生画面のキーボード・リモコン操作（元の player_keys.jsx。録画の再生・ライブ共通）。
// 割り当ては一般的な動画プレイヤーに合わせる。渡されなかった操作のキーは無視する（ライブはシーク等を持たない）

export interface PlayerKeyHandlers {
  togglePlay?: () => void;
  skip?: (sec: number) => void;
  adjustVolume?: (d: number) => void;
  toggleMute?: () => void;
  toggleFullscreen?: () => void;
  togglePip?: () => void;
  toggleCaption?: () => void;
  toggleComments?: () => void;
  toggleAudio?: () => void;
  prevChapter?: () => void;
  nextChapter?: () => void;
  prevEpisode?: () => void;
  nextEpisode?: () => void;
  seekRatio?: (r: number) => void;
  frameStep?: (d: number) => void;
  adjustSpeed?: (d: number) => void;
  back?: () => void;
}

/** キーの名前（文字はそのまま、{ t } は表示言語で引く物）と、何をするか */
export const PLAYER_KEY_HELP: { keys: (string | { t: MsgKey })[]; label: MsgKey; need: keyof PlayerKeyHandlers | null }[] = [
  { keys: ['Space', 'K', { t: 'player.playerKeys.enter' }], label: 'player.playerKeys.playPause', need: 'togglePlay' },
  { keys: ['J', 'L'], label: 'player.playerKeys.backForward10s', need: 'skip' },
  { keys: ['←', '→'], label: 'player.playerKeys.backForward5s', need: 'skip' },
  { keys: ['↑', '↓'], label: 'player.playerKeys.volumeUpDown', need: 'adjustVolume' },
  { keys: ['M'], label: 'player.playerKeys.mute', need: 'toggleMute' },
  { keys: ['F'], label: 'common.fullscreen', need: 'toggleFullscreen' },
  { keys: ['I'], label: 'player.playerKeys.picturePicture', need: 'togglePip' },
  { keys: ['C'], label: 'common.captions', need: 'toggleCaption' },
  { keys: ['D'], label: 'player.playerKeys.commentsDanmaku', need: 'toggleComments' },
  { keys: ['A'], label: 'player.playerKeys.switchMainAudio', need: 'toggleAudio' },
  { keys: ['0'], label: 'player.playerKeys.startJumpNumber1', need: 'seekRatio' },
  { keys: ['Home', 'End'], label: 'player.playerKeys.startEnd', need: 'seekRatio' },
  { keys: [',', '.'], label: 'player.playerKeys.frameBackForwardWhile', need: 'frameStep' },
  { keys: ['<', '>'], label: 'player.playerKeys.speedDownUp', need: 'adjustSpeed' },
  { keys: ['P', 'N'], label: 'player.playerKeys.previousNextChapter', need: 'prevChapter' },
  { keys: ['Shift+P', 'Shift+N'], label: 'player.playerKeys.previousNextEpisode', need: 'prevEpisode' },
  { keys: ['Esc', { t: 'common.back' }], label: 'player.playerKeys.exitFullscreenClose', need: 'back' },
  { keys: ['?'], label: 'player.playerKeys.help', need: null },
];

/** キーに当たる操作を呼ぶ。呼べたら true */
export function dispatchPlayerKey(e: { key: string; code?: string }, h: PlayerKeyHandlers): boolean {
  const call = <A extends unknown[]>(fn: ((...a: A) => void) | undefined, ...args: A) => {
    if (typeof fn !== 'function') return false;
    fn(...args);
    return true;
  };
  const key = e.key || '';
  if (key === ' ' || key === 'Spacebar' || e.code === 'Space') return call(h.togglePlay);
  switch (key) {
    case 'k': case 'K': case 'Enter':
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause':
      return call(h.togglePlay);
    case 'j': case 'J': case 'MediaRewind': return call(h.skip, -10);
    case 'l': case 'L': case 'MediaFastForward': return call(h.skip, 10);
    case 'ArrowLeft': return call(h.skip, -5);
    case 'ArrowRight': return call(h.skip, 5);
    case 'ArrowUp': return call(h.adjustVolume, 0.05);
    case 'ArrowDown': return call(h.adjustVolume, -0.05);
    case 'm': case 'M': return call(h.toggleMute);
    case 'f': case 'F': return call(h.toggleFullscreen);
    case 'i': case 'I': return call(h.togglePip);
    case 'c': case 'C': return call(h.toggleCaption);
    case 'd': case 'D': return call(h.toggleComments);
    case 'a': case 'A': return call(h.toggleAudio);
    case 'p': return call(h.prevChapter);
    case 'n': return call(h.nextChapter);
    case 'P': case 'MediaTrackPrevious': return call(h.prevEpisode);
    case 'N': case 'MediaTrackNext': return call(h.nextEpisode);
    case 'Home': return call(h.seekRatio, 0);
    case 'End': return call(h.seekRatio, 1);
    case ',': return call(h.frameStep, -1);
    case '.': return call(h.frameStep, 1);
    case '<': return call(h.adjustSpeed, -1);
    case '>': return call(h.adjustSpeed, 1);
    default: break;
  }
  if (key.length === 1 && key >= '0' && key <= '9') return call(h.seekRatio, Number(key) / 10);
  return false;
}

/** 速度の段を1つ上げ下げする（元と同じ。端で止まる） */
export function stepSpeed(speeds: readonly number[], cur: number, dir: number) {
  const i = speeds.indexOf(cur);
  return speeds[Math.min(speeds.length - 1, Math.max(0, (i < 0 ? speeds.indexOf(1) : i) + dir))]!;
}

/** 押されたキー（Web の KeyboardEvent と iOS の部品の両方から作る） */
export interface PlayerKeyInput { key: string; code?: string; ctrl: boolean; meta: boolean; alt: boolean }

/**
 * 再生画面のキー1つを処理する（元の usePlayerKeys の中身）。処理したら true（既定の動きを止める）。
 * ? で一覧の開閉、Esc・戻るは一覧を閉じる→画面を閉じる
 */
export function handlePlayerKey(e: PlayerKeyInput, h: PlayerKeyHandlers, help: { open: boolean; set: (o: boolean) => void }, onActivity: () => void): boolean {
  // 修飾キー付き（ブラウザ・OS のショートカット）は触らない。Shift は Shift+N/P と < > で使う
  if (e.ctrl || e.meta || e.alt) return false;
  if (e.key === '?') { help.set(!help.open); return true; }
  if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') {
    if (help.open) { help.set(false); return true; }
    if (h.back) { h.back(); return true; }
    return false;
  }
  if (dispatchPlayerKey(e, h)) { onActivity(); return true; }
  return false;
}
