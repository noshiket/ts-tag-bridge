// 実機の挙動ログをサーバーへ送る（前の iOS アプリと同じ /api/app/logs。設定→ログで読める）。
// iOS の部品のログ（PiP など）と、画面を操作する JS が止まっていた長さ・前面/背面の切り替えを5秒ごとにまとめて送る
import { useApi } from '@tstag/core/react';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { takeBgRenders } from './bgRenders';

const pending: { t: string; msg: string }[] = [];

export function appLog(msg: string) {
  pending.push({ t: new Date().toISOString(), msg });
  if (pending.length > 1000) pending.splice(0, pending.length - 1000);
}

export function useAppLog() {
  const api = useApi();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const device = `next-${Platform.OS}`;
    const sub = AppState.addEventListener('change', (s) => appLog(`[状態] ${s}`));
    let last = Date.now();
    let lastBg = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      // 背面にいる間に描き直した画面と回数（30秒ごと）
      if (now - lastBg >= 30_000) {
        lastBg = now;
        const bg = takeBgRenders();
        if (bg) appLog(`[監視] 背面で描き直した回数（30秒）: ${bg}`);
      }
      // 1秒ごとの予定が大きく遅れたら、その間 JS が止まっていた（背面で止められていた分も入る）
      if (now - last > 2500) appLog(`[監視] JS が ${((now - last - 1000) / 1000).toFixed(1)}秒止まっていた（${AppState.currentState}）`);
      last = now;
    }, 1000);
    const send = setInterval(() => {
      const lines = pending.splice(0).sort((a, b) => a.t.localeCompare(b.t));
      if (lines.length) api.client.post('/api/app/logs', { device, lines }).catch(() => {});
    }, 5000);
    return () => { sub.remove(); clearInterval(tick); clearInterval(send); };
  }, [api]);
}
