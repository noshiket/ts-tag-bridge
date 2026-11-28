import type { SplitEditor } from '@tstag/core/react';

/** 'HH:MM:SS'（タイムラインの下の目盛り） */
export const hms = (s: number) => {
  const v = Math.max(0, s);
  return `${String(Math.floor(v / 3600)).padStart(2, '0')}:${String(Math.floor((v % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
};

/** '25m30s'（話の長さのチップ） */
export const minSec = (p: number) => `${Math.floor(p / 60)}m${Math.floor(p % 60) >= 1 ? `${Math.floor(p % 60)}s` : ''}`;

/** 採用区間の外（外す所）。採用区間が0個の話は全体を採用 */
export function keepHoles(keeps: { from: number; to: number }[], start: number, end: number): [number, number][] {
  const ks = [...keeps].sort((a, b) => a.from - b.from);
  if (!ks.length) return [];
  const out: [number, number][] = [];
  let cur = start;
  for (const k of ks) { if (cur < k.from) out.push([cur, Math.min(k.from, end)]); cur = Math.max(cur, k.to); }
  if (cur < end) out.push([cur, end]);
  return out;
}

/**
 * 分割の画面とタブで同じ、話の端と採用区間（トリム）の操作。seek はその位置へ動かす（画面は静止画、タブは本体のプレイヤー）
 */
export function segmentEditing(ed: SplitEditor, seek: (t: number) => void) {
  const { cuts, gaps, linked, headTrim, trimEnd, segments, noRemainder, remainderAt } = ed;
  return {
    /** 余り（出力しない話）か */
    isNone: (i: number) => !noRemainder && ((remainderAt === 'end' && i === segments.length - 1) || (remainderAt === 'start' && i === 0)),
    /** OUT（話の終わり）を d 秒ずらす。最後の話は録画の終わりのトリム */
    nudgeOut: (idx: number, d: number) => {
      if (idx >= cuts.length) { const t = trimEnd + d; ed.setLastOut(t); seek(t); return; }
      if (idx < 0) return;
      ed.setOutAt(idx, cuts[idx]! + d); seek(cuts[idx]! + d);
    },
    /** IN（話の始まり）を d 秒ずらす。最初の話は録画の頭のトリム。つながっていなければ隙間の後ろから */
    nudgeIn: (segIdx: number, d: number) => {
      const cutIdx = segIdx - 1;
      if (cutIdx < 0) { const t = headTrim + d; ed.setInAt(0, t); seek(t); return; }
      const cur = cuts[cutIdx]! + (linked ? 0 : gaps[cutIdx] || 0);
      ed.setInAt(segIdx, cur + d); seek(cur + d);
    },
    /** トリムの IN / OUT を t に置く（同じ話の続きなら片方だけ上書き） */
    markKeep: (i: number, side: 'in' | 'out', t: number) => ed.setPendingKeep((p) => (p?.segIdx === i
      ? { ...p, [side]: t } : { segIdx: i, in: side === 'in' ? t : null, out: side === 'out' ? t : null })),
    /** 置いた IN / OUT で採用区間を足す（並べ替えて入れる） */
    addKeep: (i: number, from: number, to: number) => {
      ed.setKeepList((t) => ({ ...t, [i]: [...(t[i] ?? []), { from, to }].sort((a, b) => a.from - b.from) }));
      ed.setPendingKeep(null);
    },
    removeKeep: (i: number, ti: number) => ed.setKeepList((tl) => ({ ...tl, [i]: (tl[i] ?? []).filter((_, j) => j !== ti) })),
    /** 出力しない（SKIP）の切り替え */
    toggleSkip: (i: number) => ed.setSkipList((sl) => { const n = { ...sl }; if (n[i]) delete n[i]; else n[i] = true; return n; }),
  };
}

/** 置きかけのトリムの IN / OUT から、足せる区間（両方置いて長さがあれば） */
export function pendingRange(p: { in: number | null; out: number | null } | null) {
  if (p?.in == null || p.out == null || p.in === p.out) return null;
  return { from: Math.min(p.in, p.out), to: Math.max(p.in, p.out) };
}
