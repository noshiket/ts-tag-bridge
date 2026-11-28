// パターンの照合（形は合うが未登録の候補・サーバーの完全マッチ）と、照合・テスト実行に渡す番組の情報
import { applyAnalyze, patternToRegex, type AnalyzeItem, type Groups, type Pattern } from './parse';
import type { Segment } from './segments';

/** パターン一覧の1件（pattern_index は保存の時に使う番号） */
export type Analyzer = Pattern & { pattern_index?: number; pattern2?: string; text2?: string; analyze?: AnalyzeItem[] };

/** pattern2 の途中一致（サーバーの re.search に当たる）。AND条件が無ければ通す */
export function matchPattern2(a: Analyzer, context: Record<string, unknown>): boolean {
  if (!a.pattern2 || !a.text2) return true;
  const v = String(context[a.text2.replace(/^\$/, '')] ?? '');
  if (!v) return false;
  return new RegExp(a.pattern2.split(/\{\$\d+\}/).map((p) => p.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')).join('([\\s\\S]+?)')).test(v);
}

const groupsOf = (pattern: string, m: RegExpMatchArray): Groups =>
  Object.fromEntries([...pattern.matchAll(/\{\$(\d+)\}/g)].map((x, i) => [`g${x[1]}`, m[i + 1]!]));
const switchVar = (sw: unknown) => String(sw ?? '').match(/\{\$(\d+)\}/)?.[1];

/** 追加候補: 形は合うが switch の値が未登録（else も無い）パターン */
export function findPatternsByString(title: string, analyzers: Analyzer[], context: Record<string, unknown>) {
  const out: { analyzer: Analyzer; groups: Groups; newValue: string | null }[] = [];
  for (const a of analyzers) {
    const m = title.match(patternToRegex(a.pattern));
    if (!m || !matchPattern2(a, context)) continue;
    const groups = groupsOf(a.pattern, m);
    let canParse = false;
    let newValue: string | null = null;
    for (const it of a.analyze ?? []) {
      if ('switch' in it) {
        const v = switchVar(it.switch);
        const sw = v ? groups[`g${v}`] ?? null : null;
        if (it.list?.find((l) => l.str === sw) || (it.else?.length ?? 0) > 0) canParse = true; else newValue = sw;
      } else canParse = true;
    }
    if (!canParse) out.push({ analyzer: a, groups, newValue });
  }
  return out;
}

/** サーバーの照合（/api/patterns/matches）の1件 */
export interface ServerMatch { index: number; match_type: 'list' | 'else' | 'direct'; matched_str?: string; groups?: Groups }
export interface MatchedPattern { analyzer: Analyzer; groups: Groups; matchType: ServerMatch['match_type']; matchedStr?: string; parseResult: Record<string, unknown>; adopted: boolean }

/** 完全マッチの一覧（判定はサーバー。表示する解析結果はその枝の analyze を当てたもの） */
export function matchedPatterns(analyzers: Analyzer[], rep: { matches?: ServerMatch[]; adopted_index?: number | null }): MatchedPattern[] {
  return (rep.matches ?? []).map((m) => {
    const a = analyzers[m.index] ?? ({ pattern: '' } as Analyzer);
    const sw = (a.analyze ?? []).find((it) => 'switch' in it);
    const block = m.match_type === 'list' ? (sw?.list?.find((l) => l.str === m.matched_str)?.analyze ?? [])
      : m.match_type === 'else' ? (sw?.else ?? []) : (a.analyze ?? []);
    return { analyzer: a, groups: m.groups ?? {}, matchType: m.match_type, matchedStr: m.matched_str, parseResult: applyAnalyze(block, m.groups ?? {}), adopted: m.index === rep.adopted_index };
  });
}

/** 'YYYY-MM-DD HH:MM' には秒を足す（サーバーの解析が秒まで要る） */
export const withSeconds = (s: string) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s) ? `${s}:00` : s);

/** 番組の情報（パターン登録の CONTEXT） */
export interface PatternCtx { id: string; title: string; service_name: string; sid?: number; onid?: number; tsid?: number; start: string; description: string; extended_info: string }

/** テスト実行・照合に渡す context */
export function analyzeContext(ctx: PatternCtx | null, tp: Record<string, unknown>): Record<string, unknown> {
  return {
    ...tp, title: ctx?.title ?? '', sid: ctx?.sid, onid: ctx?.onid, tsid: ctx?.tsid, service_name: ctx?.service_name ?? '',
    start_time: withSeconds(ctx?.start ?? ''), description: ctx?.description ?? '', extended_info: ctx?.extended_info ?? '',
  };
}

/** 文字を取ってくるアクション（副題の取得など）の予行検索と副題パターンビルダーに渡すもの */
export function buildFetchTextCtx(ctx: PatternCtx | null, tp: Record<string, unknown>, segLists: Segment[][]) {
  const usedGroupNums = new Set<number>();
  const groups: Record<string, string> = {};
  segLists.forEach((segs) => segs.forEach((s) => { if (s.group) { usedGroupNums.add(s.group); groups[s.group] = s.text; } }));
  return { sid: ctx?.sid, usedGroupNums, groups, context: analyzeContext(ctx, tp) };
}
export type FetchTextCtx = ReturnType<typeof buildFetchTextCtx> & { fields?: Record<string, string> };
