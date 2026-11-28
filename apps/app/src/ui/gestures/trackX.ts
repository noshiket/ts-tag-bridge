import type { GestureResponderEvent } from 'react-native';

/**
 * 横の棒の上で押した位置（棒の左端からの距離）。Web は画面の上の横位置で測るので、
 * 再生画面を 90° 回した時（横画面 ⟳）は棒が縦に見える。その時は縦の位置で測る（上が棒の左端）
 */
export function trackX(e: GestureResponderEvent, width: number) {
  const el = e.currentTarget as unknown as HTMLElement | null;
  const r = el?.getBoundingClientRect?.();
  if (r && r.height > r.width) return ((e.nativeEvent.pageY - window.scrollY - r.top) / r.height) * width;
  return e.nativeEvent.locationX;
}
