import { Platform } from 'react-native';

/**
 * 横向きか。ふつうは画面の縦横の大きさで決める。
 * スマホ・タブレットの Web は端末の向きで決める: Web の画面の大きさはキーボードを除いた見えている部分なので、
 * iPhone の縦向きで入力欄を押してキーボードが出ると高さが幅を下回り、横向きと取り違えた
 * （再生画面の下の欄が消え、パターンの編集中の内容ごと失われた。2026-11-21）
 * rotated: 縦持ちのまま画面を 90° 回して横として並べている（useRotation。win は回した後の大きさ）。その時は大きさで決める
 */
export function isLandscape(win: { width: number; height: number }, rotated = false): boolean {
  if (!rotated && Platform.OS === 'web' && typeof window !== 'undefined' && navigator.maxTouchPoints > 0) {
    const type = window.screen?.orientation?.type;
    if (type) return type.startsWith('landscape');
    if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
  }
  return win.width > win.height;
}
