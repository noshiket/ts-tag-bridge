// 再生位置(秒) ⇔ 放送時刻(TOT)。元の Web 版の WatchStore（helpers.jsx）と同じ計算。
// 続きの位置は放送時刻で持つ（録画とエンコード後の動画で同じ場所を指せるように）。
// 動画は CM を切った区間(trim_segments)をつないだものなので、区間ごとに足し引きする。
// 受信が途切れた所(pts_gaps)は放送時刻は進んでも映像は進まないので、その分を引く。

export interface TimingMeta {
  duration?: number | null;
  recording_start_time?: string | null;
  trim_segments?: { start: string; end: string; duration_sec?: number }[] | null;
  pts_gaps?: { start_tot: string; lost_sec: number }[] | null;
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

function segments(meta: TimingMeta) {
  const out: { startMs: number; endMs: number; dur: number; cum: number }[] = [];
  let cum = 0;
  for (const s of meta.trim_segments ?? []) {
    const sm = ms(s.start);
    const em = ms(s.end);
    if (sm == null || em == null) continue;
    const dur = typeof s.duration_sec === 'number' ? s.duration_sec : (em - sm) / 1000;
    out.push({ startMs: sm, endMs: em, dur, cum });
    cum += dur;
  }
  return out;
}

function gaps(meta: TimingMeta) {
  return (meta.pts_gaps ?? [])
    .map((g) => ({ startMs: ms(g.start_tot), lostSec: Number(g.lost_sec) }))
    .filter((g): g is { startMs: number; lostSec: number } => g.startMs != null && g.lostSec > 0)
    .sort((a, b) => a.startMs - b.startMs);
}

/** fromMs から toMs までに失われた再生時間(秒) */
function lostBetween(gs: ReturnType<typeof gaps>, fromMs: number, toMs: number) {
  let t = 0;
  for (const g of gs) {
    if (g.startMs < fromMs) continue;
    if (g.startMs >= toMs) break;
    t += Math.min(g.lostSec, (toMs - g.startMs) / 1000);
  }
  return t;
}

/** 放送時刻へ直せるか（録画開始時刻か区間がある） */
export const hasTot = (meta: TimingMeta) => ms(meta.recording_start_time) != null || segments(meta).length > 0;

/** 再生位置(秒) → 放送時刻(ms)。直せなければ null */
export function posToTot(meta: TimingMeta, pos: number): number | null {
  const gs = gaps(meta);
  // 再生位置には欠落が含まれないので、放送時刻へ戻す時は足し直す
  const addLost = (startMs: number, rel: number) => {
    let t = startMs + rel * 1000;
    for (const g of gs) {
      if (g.startMs < startMs) continue;
      if (g.startMs > t) break;
      t += g.lostSec * 1000;
    }
    return t;
  };
  const segs = segments(meta);
  if (segs.length) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      if (pos < s.cum + s.dur || i === segs.length - 1) return addLost(s.startMs, Math.max(0, pos - s.cum));
    }
    return null;
  }
  const base = ms(meta.recording_start_time);
  return base != null ? addLost(base, pos) : null;
}

/** 放送時刻(ms) → 再生位置(秒)。直せなければ null */
export function totToPos(meta: TimingMeta, totMs: number): number | null {
  const dur = meta.duration || 0;
  const gs = gaps(meta);
  const segs = segments(meta);
  if (segs.length) {
    for (const s of segs) {
      if (totMs <= s.endMs) {
        // 区間の間（CM）なら次の区間の頭へ寄せる
        return totMs >= s.startMs ? s.cum + (totMs - s.startMs) / 1000 - lostBetween(gs, s.startMs, totMs) : s.cum;
      }
    }
    return dur;
  }
  const base = ms(meta.recording_start_time);
  if (base == null) return null;
  const p = (totMs - base) / 1000 - lostBetween(gs, base, totMs);
  return dur ? Math.max(0, Math.min(p, dur)) : Math.max(0, p);
}
