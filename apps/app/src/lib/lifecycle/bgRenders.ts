// 切り分け用: アプリが背面にいる間（小窓で再生中など）に、どの画面・部品が何回描き直したかを数える。
// 背面で描き直しが続くと画面の処理が詰まり、小窓の間に止まりが伸びていった（2026-11-16）。30秒ごとに appLog へ出す
import { AppState } from 'react-native';

const counts = new Map<string, number>();

/** 描くたびに呼ぶ（背面の時だけ数える） */
export function useBgRenderCount(name: string) {
  if (AppState.currentState === 'active') return;
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

/** 数えた分を文字にして空にする（無ければ null） */
export function takeBgRenders(): string | null {
  if (!counts.size) return null;
  const s = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' ');
  counts.clear();
  return s;
}
