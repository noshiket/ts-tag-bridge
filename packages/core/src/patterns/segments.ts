// パターンビルダーの区切り（元の parse.jsx の TitleSegmenter）: 題名・説明文を地の文字と {$N} に分ける
import { patternToRegex } from './parse';

/** 文字の区切り。group は {$N} の番号（null は地の文字） */
export interface Segment { text: string; group: number | null; key: number }
export type TextSource = '$title' | '$description' | '$extended_info';

export const initSegs = (t: string): Segment[] => (t ? [{ text: t, group: null, key: 0 }] : []);
/** 区切り → 'タイトル #{$2}' */
export const segPattern = (segs: Segment[]) => segs.map((s) => (s.group ? `{$${s.group}}` : s.text)).join('');
export const segText = (segs: Segment[]) => segs.map((s) => s.text).join('');

function rebuild(flat: { ch: string; group: number | null }[]): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  for (const f of flat) {
    const key = f.group || 0;
    if (!cur || cur.key !== key) { if (cur) out.push(cur); cur = { key, text: f.ch, group: f.group || null }; } else cur.text += f.ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 文字の範囲 [start, end) を {$group} にする */
export function assignGroup(segs: Segment[], start: number, end: number, group: number): Segment[] {
  const flat = segs.flatMap((s) => [...s.text].map((ch) => ({ ch, group: s.group })));
  return rebuild(flat.map((f, i) => (i >= start && i < end ? { ...f, group } : f)));
}

/** その区切りのグループを外し、隣の地の文字とつなげる */
export function removeGroup(segs: Segment[], idx: number): Segment[] {
  const merged: Segment[] = [];
  for (const s of segs.map((x, i) => (i === idx ? { ...x, group: null, key: 0 } : x))) {
    const last = merged[merged.length - 1];
    if (last && !last.group && !s.group) merged[merged.length - 1] = { ...last, text: last.text + s.text };
    else merged.push({ ...s });
  }
  return merged;
}

/** 割り当てに出す番号（使っていない番号から4つ） */
export function freeGroups(used: Set<number>): number[] {
  const out: number[] = [];
  for (let n = 1; out.length < 4 && n <= 99; n++) if (!used.has(n)) out.push(n);
  return out;
}

function splitByMatch(text: string, nums: number[], m: RegExpMatchArray): Segment[] {
  const out: Segment[] = [];
  let rest = text;
  let key = 0;
  nums.forEach((n, i) => {
    const v = m[i + 1];
    if (!v) return;
    const at = rest.indexOf(v);
    if (at < 0) return;
    if (at > 0) out.push({ text: rest.slice(0, at), group: null, key: key++ });
    out.push({ text: v, group: n, key: key++ });
    rest = rest.slice(at + v.length);
  });
  if (rest) out.push({ text: rest, group: null, key: key++ });
  return out;
}

/** 登録済みのパターンを題名に当て、どこが {$N} かを区切りで出す（当たらなければ null） */
export function segmentsFromPattern(title: string, pattern: string): Segment[] | null {
  const m = title.match(patternToRegex(pattern));
  if (!m) return null;
  const segs = splitByMatch(title, [...pattern.matchAll(/\{\$(\d+)\}/g)].map((x) => +x[1]!), m);
  return segs.length ? segs : null;
}

/**
 * AND条件（pattern2）を説明文に当てる（途中一致）。
 * stripBrackets は再生画面のタブの書き方（[…] を空白にする）。パターン画面は元の文（[番組名] 入り）へ当てるので落とさない
 * （片側だけ落とすと固定部分が合わず、分割できない）
 */
export function segmentsFromPattern2(text: string, pattern2: string, stripBrackets = true): Segment[] | null {
  if (!text || !pattern2) return null;
  const norm = stripBrackets ? pattern2.replace(/\[[^\]]*\]/g, ' ').replace(/ +/g, ' ').trim() : pattern2;
  const nums = [...norm.matchAll(/\{\$(\d+)\}/g)].map((x) => +x[1]!);
  let re = '';
  norm.split(/\{\$\d+\}/).forEach((p, i) => {
    re += p.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    if (i < nums.length) re += i === nums.length - 1 ? '([\\s\\S]+)' : '([\\s\\S]+?)';
  });
  const m = text.match(new RegExp(re));
  if (!m) return null;
  const segs = splitByMatch(text, nums, m);
  return segs.length ? segs : null;
}
