// 録画の分割の区切り（複数話をまとめた録画を話ごとに分ける区間）。元の Web 版の split.jsx の SegmentsInfo と同じ読み方。
// 1つの区切りは 'HH:MM:SS.mmm-HH:MM:SS.mmm' に ',SKIP' や ',keep(..)' ',TOT(..)' が続く。'full' は1話・全体

export interface SegmentView {
  /** 'full'（全体） */
  full: boolean;
  start: string;
  end: string;
  /** 0〜0 の区間（その話は無い） */
  absent: boolean;
  /** エンコードしない */
  skip: boolean;
  /** 録画の頭からの開始（秒）。全体は絵を取るため 5 秒 */
  startSec: number;
  endSec: number;
  /** 採用する区間（'@' の後はチャプター名） */
  keep: string[];
  /** 旧い形式の除く区間（keep が無い時だけ） */
  oldTrims: string[];
  /** 区間の頭の放送時刻 */
  tot: string | null;
}

const hms = (s: string) => s.split(':').reduce((acc, v, i) => acc + parseFloat(v) * [3600, 60, 1][i]!, 0);

export function parseSegment(seg: string): SegmentView {
  const parts = seg.split(',');
  const base = parts[0]!;
  const full = base === 'full';
  const [start, end] = full ? ['00:00:00.000', '(全体)'] : (base.split('-') as [string, string]);
  const absent = !full && start === '00:00:00.000' && end === '00:00:00.000';
  const keep = [...seg.matchAll(/(?:^|,)keep\d*\(([^-@)]+)-([^-@)]+)(?:@([^)]*))?\)/g)].map((m) => `${m[1]}-${m[2]}${m[3] ? ` (${m[3]})` : ''}`);
  return {
    full, start, end, absent, skip: parts.includes('SKIP'),
    startSec: full ? 5 : hms(start), endSec: full ? Infinity : absent ? 0 : hms(end), keep,
    oldTrims: keep.length ? [] : [...seg.matchAll(/(?:^|,)trim\d*\(([^-]+)-([^)]+)\)/g)].map((m) => `${m[1]}-${m[2]}`),
    tot: seg.match(/(?:^|,)TOT\(([^,]+),([^)]+)\)/)?.[1] ?? null,
  };
}

/** SKIP を付ける・外す（区間のすぐ後ろに入れる） */
export function toggleSegmentSkip(segments: string[], i: number): string[] {
  const next = [...segments];
  const parts = next[i]!.split(',');
  next[i] = parts.includes('SKIP')
    ? parts.filter((p) => p !== 'SKIP').join(',')
    : `${parts[0]},SKIP,${parts.slice(1).join(',')}`.replace(/,+$/, '');
  return next;
}

export interface DropEvent { sec: number; scramble: boolean; desc: string; n: number }

/**
 * drop / scramble を録画の頭からの秒にする（tot_time − 録画の開始）。重複パケットなど害の無いものは除き、
 * 同じ秒に何件も並ぶもの（多くの PID が同時に落ちる）は1つにまとめて数える（シークバーと同じ）
 */
export function dropEvents(dropError: unknown, recordingStart: string | null): DropEvent[] {
  let de = dropError;
  if (typeof de === 'string') { try { de = JSON.parse(de); } catch { return []; } }
  const t0 = recordingStart ? Date.parse(recordingStart) : NaN;
  if (!de || !Number.isFinite(t0)) return [];
  const raw: Omit<DropEvent, 'n'>[] = [];
  for (const e of ((de as { errors?: Record<string, unknown>[] }).errors ?? [])) {
    const ty = String(e.error_type || '');
    if (!e.tot_time || (ty !== 'PACKET_LOSS' && !ty.includes('SCRAMBLE'))) continue;
    const t = Date.parse(String(e.tot_time));
    if (Number.isFinite(t)) raw.push({ sec: (t - t0) / 1000, scramble: ty.includes('SCRAMBLE'), desc: String(e.description || ty) });
  }
  raw.sort((a, b) => a.sec - b.sec);
  const merged: DropEvent[] = [];
  for (const d of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.scramble === d.scramble && Math.floor(prev.sec) === Math.floor(d.sec)) prev.n += 1;
    else merged.push({ ...d, n: 1 });
  }
  return merged;
}

/** その区間に入る drop / scramble と、その件数 */
export function segmentDrops(seg: SegmentView, events: DropEvent[]) {
  const list = seg.absent ? [] : events.filter((d) => d.sec >= (seg.full ? 0 : seg.startSec) && d.sec <= seg.endSec);
  return {
    list,
    drop: list.reduce((a, d) => a + (d.scramble ? 0 : d.n), 0),
    scramble: list.reduce((a, d) => a + (d.scramble ? d.n : 0), 0),
  };
}

/** 区間の頭からの位置（N分SS秒） */
export const offsetLabel = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
};
