// アプリが前に出ているか。背面（小窓で再生中など）の間は誰も画面を見ていないので、再生位置に合わせた
// 描き直しを止めるのに使う。背面でも描き直し続けると、画面へ反映する処理が小窓に映像を送るのと同じ
// スレッドを長く塞ぎ、小窓の映像が止まって音だけになった（2026-11-15、実機）
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const isAppActive = () => AppState.currentState === 'active' || AppState.currentState == null;

export function useAppActive(): boolean {
  const [active, setActive] = useState(isAppActive);
  useEffect(() => {
    const sub = AppState.addEventListener('change', () => setActive(isAppActive()));
    return () => sub.remove();
  }, []);
  return active;
}
