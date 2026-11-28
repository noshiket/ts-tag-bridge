import { useEffect, useState } from 'react';

import { setPlayerFullscreen } from '../../lib/playback/fullscreenState';

/**
 * 全画面: 映像を画面いっぱいに出し、ブラウザの全画面にもする（Esc で抜けた時も合わせる）。
 * iPhone の Safari のように全画面が使えない時は、画面の中で広げるだけ（元と同じ）
 */
// active・portrait はアプリ（端末の向きの固定）だけで使う。Web は全画面でも向きを変えない
export function useFullscreen(_active = true, _portrait = false): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setOn(false); };
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggle = () => {
    if (on) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setOn(false);
    } else {
      void document.documentElement.requestFullscreen?.()?.catch(() => {});
      setOn(true);
    }
  };
  // PC の縦の帯を隠す（抜けた時・画面を離れた時は戻す）
  useEffect(() => { setPlayerFullscreen(on); return () => setPlayerFullscreen(false); }, [on]);
  return [on, toggle];
}
