// 録画の分割（元の split_editor.jsx の buildSplitSource・frameNo・trimFramePreview と split.jsx の fmtMs / fmtDur）。
// 分割は録画の segments（"開始-終了[,SKIP][,keep(...)][,mute(...)][,chap(...)]" の並び）で持つ

/** 採用区間（元の時間）。name はチャプター名 */
export interface KeepRange { from: number; to: number; name?: string }
export interface TimeRange { from: number; to: number }

/** 分割の編集を始める元（元の buildSplitSource の、分割タブと分割画面で使うもの） */
export interface SplitSource {
  id: number;
  dbRecId: number;
  name: string;
  duration: number;
  /** 1話の長さ（分）の始めの値 */
  broadcastMin: number;
  episodeCount: number;
  baseTitle: string;
  outputPaths: string[];
  initialCuts: number[];
  initialKeepList: Record<number, KeepRange[]>;
  /** 話 → { 元の時間(3桁固定小数点の文字列): 名前 } */
  initialChapNames: Record<number, Record<string, string>>;
  initialMutes: Record<number, TimeRange[]>;
  initialSkips: Record<number, boolean>;
  dropRanges: { start: number; end: number }[];
}

/** 秒 → 'HH:MM:SS.mmm' */
export function fmtMs(s: number): string {
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
/** 秒 → '1h 2m' / '3m 4s' / '5s' */
export function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const toSec = (t: string) => t.split(':').reduce((a, v, i) => a + parseFloat(v) * [3600, 60, 1][i]!, 0);

/** 分割の元を録画から組む（元の buildSplitSource） */
export function buildSplitSource(r: {
  id: number; db_rec_id?: number | null; title: string; rec_file_path?: string | null; duration_sec?: number | null; duration_min?: number | null;
  segments?: string[] | string | null; confirmed?: Record<string, unknown> | null; drop_error?: unknown; recording_start_time?: string | null;
}): SplitSource {
  const segs = Array.isArray(r.segments) ? r.segments : r.segments ? [r.segments] : [];
  const initialCuts = segs.slice(0, -1).map((s) => toSec(s.split(',')[0]!.split('-')[1]!));
  const initialKeepList: SplitSource['initialKeepList'] = {};
  const initialChapNames: SplitSource['initialChapNames'] = {};
  const initialMutes: SplitSource['initialMutes'] = {};
  const initialSkips: SplitSource['initialSkips'] = {};
  segs.forEach((seg, i) => {
    // keep(...) = 採用区間（今の形）。'@' 以降はチャプター名。trim(...) = 除去区間（旧い形）で、補集合を取って採用区間へ揃える。
    // 中身を足した形の keepN.TOT / keepN.pts は直後が '.' なので当たらない
    const keeps = [...seg.matchAll(/(?:^|,)keep\d*\(([^-@)]+)-([^-@)]+)(?:@([^)]*))?\)/g)]
      .map((m) => ({ from: toSec(m[1]!), to: toSec(m[2]!), name: m[3] || '' }));
    const mutes = [...seg.matchAll(/(?:^|,)mute\d*\(([^-)]+)-([^-)]+)\)/g)].map((m) => ({ from: toSec(m[1]!), to: toSec(m[2]!) }));
    if (mutes.length) initialMutes[i] = mutes.sort((a, b) => a.from - b.from);
    for (const m of seg.matchAll(/(?:^|,)chap\d*\(([^@)]+)@([^)]*)\)/g)) {
      initialChapNames[i] = { ...(initialChapNames[i] ?? {}), [toSec(m[1]!).toFixed(3)]: m[2]! };
    }
    if (keeps.length) initialKeepList[i] = keeps.sort((a, b) => a.from - b.from);
    else {
      const removes = [...seg.matchAll(/(?:^|,)trim\d*\(([^-]+)-([^)]+)\)/g)].map((m) => ({ from: toSec(m[1]!), to: toSec(m[2]!) })).sort((a, b) => a.from - b.from);
      if (removes.length) {
        const [bs, be] = seg.split(',')[0]!.split('-').map(toSec) as [number, number];
        const out: KeepRange[] = [];
        let cursor = bs;
        for (const x of removes) {
          const f = Math.min(x.from, be);
          const t = Math.min(x.to, be);
          if (cursor < f) out.push({ from: cursor, to: f });
          cursor = Math.max(cursor, t);
        }
        if (cursor < be) out.push({ from: cursor, to: be });
        if (out.length) initialKeepList[i] = out;
      }
    }
    if (seg.split(',').includes('SKIP')) initialSkips[i] = true;
  });
  const c = r.confirmed ?? {};
  // confirmed.title は複数話だと並びになる
  const cTitle = Array.isArray(c.title) ? (c.title as unknown[]).filter(Boolean).join(', ') : String(c.title ?? '');
  const dur = r.duration_sec ?? 0;
  const out = c.app_output_path;
  return {
    id: r.id,
    dbRecId: r.db_rec_id ?? r.id,
    name: (r.rec_file_path ?? '').split('/').pop() || r.title,
    duration: dur,
    broadcastMin: Number(c.broadcast_min ?? r.duration_min ?? 30),
    episodeCount: Number(c.episode_count ?? (initialCuts.length > 0 ? initialCuts.length + 1 : 1)),
    baseTitle: cTitle || r.title,
    outputPaths: Array.isArray(out) ? (out as string[]).filter(Boolean) : out ? String(out).split(',').map((s) => s.trim()).filter(Boolean) : [],
    initialCuts, initialKeepList, initialChapNames, initialMutes, initialSkips,
    dropRanges: dropRanges(r.drop_error, dur, r.recording_start_time ?? null),
  };
}

/** ドロップの起きた所（3秒以内の続きは1つにまとめる） */
function dropRanges(de: unknown, dur: number, recordingStart: string | null) {
  const d = de as { errors?: { tot_time?: string; packet_number?: number }[]; total_packets?: number } | null;
  if (!d?.errors?.length || !dur) return [];
  const total = d.total_packets || 1;
  const pos = d.errors.map((e) => {
    if (e.tot_time && recordingStart) {
      const p = (Date.parse(e.tot_time) - Date.parse(recordingStart)) / 1000;
      return Number.isFinite(p) && p >= 0 && p <= dur ? p : null;
    }
    return ((e.packet_number ?? 0) / total) * dur;
  }).filter((t): t is number => t != null).sort((a, b) => a - b);
  if (!pos.length) return [];
  const out: { start: number; end: number }[] = [];
  let s = pos[0]!;
  let e = pos[0]!;
  for (let j = 1; j < pos.length; j++) {
    if (pos[j]! - e <= 3) e = pos[j]!;
    else { out.push({ start: s, end: e }); s = e = pos[j]!; }
  }
  out.push({ start: s, end: e });
  return out;
}

/**
 * Amatsukaze に合わせたコマの番号（t=0 がファイルの頭・一定のコマ速度とみなした近い値）。
 * 実際のエンコードはサーバーが実際の PTS から直すので、ずれても出来上がりには響かない
 */
export const AMZ_FPS = 30000 / 1001;
export const frameNo = (t: number, fps = AMZ_FPS) => Math.max(0, Math.floor(t * fps + 1e-6));
/** 採用区間を Amatsukaze の Trim(a,b)（終わりを含む）の書き方で */
export const trimFramePreview = (from: number, to: number, fps = AMZ_FPS) =>
  `#${frameNo(from, fps)}-${Math.max(frameNo(from, fps), frameNo(to, fps) - 1)}`;

/** interval と話数から自動の切れ目を作る（余りの話は end なら最後、start なら最初） */
export function autoCuts(total: number, episodeCount: number, intervalMin: number, remainderAt: 'start' | 'end'): number[] {
  const step = intervalMin * 60;
  const remainder = Math.max(0, total - episodeCount * step);
  const durs = remainderAt === 'end' ? [...Array(episodeCount).fill(step), remainder] : [remainder, ...Array(episodeCount).fill(step)];
  const arr: number[] = [];
  let pos = 0;
  for (let i = 0; i < durs.length - 1; i++) { pos += durs[i]!; arr.push(Math.min(Math.round(pos * 1000) / 1000, total)); }
  return arr;
}

export interface SplitSegment { start: number; end: number; idx: number; gapAfter: number }

/** 切れ目と隙間から話の区間を作る */
export function segmentsFrom(cuts: number[], gaps: number[], headTrim: number, trimEnd: number): SplitSegment[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: SplitSegment[] = [];
  let prev = headTrim;
  sorted.forEach((c, i) => { out.push({ start: prev, end: c, idx: i + 1, gapAfter: gaps[i] || 0 }); prev = c + (gaps[i] || 0); });
  out.push({ start: prev, end: trimEnd, idx: sorted.length + 1, gapAfter: 0 });
  return out;
}

/**
 * 保存する segments（話の添字はそのまま。余りの話は null）。区切りの文字はチャプター名から落とす。
 * 詰めた並びを使うとチャプターを話ごとに引く時に添字がずれる（元と同じ理由で添字を保つ）
 */
export function buildSegmentsIndexed(p: {
  segments: SplitSegment[]; noRemainder: boolean; remainderAt: 'start' | 'end';
  skipList: Record<number, boolean>; keepList: Record<number, KeepRange[]>;
  manualMutes: Record<number, TimeRange[]>; chapNames: Record<number, Record<string, string>>;
}): (string | null)[] {
  const clean = (s: string) => s.replace(/[,@()]/g, '').trim();
  return p.segments.map((s, i) => {
    if (!p.noRemainder && ((p.remainderAt === 'end' && i === p.segments.length - 1) || (p.remainderAt === 'start' && i === 0))) return null;
    const parts = [`${fmtMs(s.start)}-${fmtMs(s.end)}`];
    if (p.skipList[i] || s.start === s.end) parts.push('SKIP');
    for (const k of [...(p.keepList[i] ?? [])].sort((a, b) => a.from - b.from)) {
      const nm = clean(k.name ?? '');
      parts.push(`keep(${fmtMs(k.from)}-${fmtMs(k.to)}${nm ? `@${nm}` : ''})`);
    }
    for (const mu of p.manualMutes[i] ?? []) parts.push(`mute(${fmtMs(mu.from)}-${fmtMs(mu.to)})`);
    for (const [sec, nm] of Object.entries(p.chapNames[i] ?? {})) {
      const c = clean(String(nm || ''));
      if (c) parts.push(`chap(${fmtMs(Number(sec))}@${c})`);
    }
    return parts.join(',');
  });
}
