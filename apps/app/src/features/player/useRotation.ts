import { useState } from 'react';
import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

import { deviceStore } from '../../lib/device/deviceStore';

/** 最後の状態を覚える（元と同じ名前） */
const KEY = 'tstag_player_landscape';

/**
 * 横画面（元の ⟳）。端末を縦に持ったまま、再生画面を 90° 回して横に使う（画面の向きを固定していても横で見られる）。
 * 回すのは画面が縦で、前に出ている時だけ。win は回した後の大きさ（並びはこれで決める）。
 * 全画面は回さない（⟳ の状態だけ尊重する）。
 * Web だけ（Safari は端末の向きを変えられないため）。アプリは全画面で端末の向きごと横にするので ⟳ は無い（available）
 */
const available = Platform.OS === 'web';
export function useRotation(active: boolean) {
  const real = useWindowDimensions();
  const [on, setOn] = useState(() => deviceStore.get(KEY) === '1');
  const toggle = () => setOn((o) => { deviceStore.set(KEY, o ? '0' : '1'); return !o; });
  const rotated = available && on && active && real.height > real.width;
  const win = rotated ? { width: real.height, height: real.width } : { width: real.width, height: real.height };
  const style: ViewStyle | null = rotated ? {
    position: 'absolute', width: real.height, height: real.width,
    left: (real.width - real.height) / 2, top: (real.height - real.width) / 2,
    transform: [{ rotate: '90deg' }],
  } : null;
  return { available, on, rotated, toggle, win, real, style };
}
