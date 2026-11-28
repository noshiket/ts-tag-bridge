// 再生画面の「切り抜き」タブ（元の stream_right_tab_clip.jsx）。フレーム表（server/media/mp4_frames.py）から各コマの表示時刻を出す。
// エンコード結果は可変フレームレートのことがあり、1/30 秒の決め打ちでは実際のコマに乗らないため

export interface FrameTable { index: string; deltas: number[]; timebase: number; first: number }

/** gzip を解いた index（各コマの deltas の番号）→ 各コマの表示時刻（秒） */
export function frameTimes(idx: Uint8Array, table: Pick<FrameTable, 'deltas' | 'timebase' | 'first'>): Float64Array {
  const out = new Float64Array(idx.length + 1);
  let cur = table.first;
  out[0] = cur / table.timebase;
  for (let i = 0; i < idx.length; i++) { cur += table.deltas[idx[i]!]!; out[i + 1] = cur / table.timebase; }
  return out;
}

/** 秒 → その時刻を含むコマの番号（二分探索）。表が空なら -1 */
export function frameAt(times: ArrayLike<number>, sec: number): number {
  if (!times.length) return -1;
  let lo = 0, hi = times.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= sec + 1e-9) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** そのコマの表示時刻へ吸着させる（表が無ければそのまま） */
export function snapToFrame(times: ArrayLike<number>, sec: number): number {
  const i = frameAt(times, sec);
  return i >= 0 ? times[i]! : sec;
}
