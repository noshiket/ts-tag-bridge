// パターンの登録・編集の組み立て（else・タイトル別エントリのアクションを読む・足す・差し替える・消す）
import { actionsToAnalyze, defaultActions, rawToAction, type Action, type ActionDef, type RawAction } from './actions';
import type { Analyzer } from './matching';
import type { AnalyzeItem } from './parse';

/** 「＋ 登録」で作るタイトル別エントリの初めのアクション: else を写す。無ければ既定。出力パスが無ければ足す */
export function baseActionsForNewTitle(a: Analyzer, schema: ActionDef[], outputPath: string): Action[] {
  const rawElse = (a.analyze ?? []).find((it) => 'switch' in it && (it.else?.length ?? 0) > 0)?.else ?? [];
  if (!rawElse.length) return defaultActions(a.pattern, outputPath);
  const actions = rawElse.map((r) => rawToAction(r as RawAction, schema)).filter((x): x is Action => !!x);
  if (!actions.some((x) => x.type === 'setPath')) actions.push({ type: 'setPath', field: 'app_output_path', str: outputPath || '' });
  return actions;
}

/** else の編集で読むアクション */
export function elseActions(a: Analyzer, schema: ActionDef[]): Action[] {
  const raw = (a.analyze ?? []).find((it) => 'switch' in it && it.else)?.else ?? [];
  return raw.map((r) => rawToAction(r as RawAction, schema)).filter((x): x is Action => !!x);
}
/** タイトル別エントリの編集で読むアクション（無ければパターン直下） */
export function listActions(a: Analyzer, title: string | undefined, schema: ActionDef[]): Action[] {
  const entry = (a.analyze ?? []).flatMap((it) => it.list ?? []).find((l) => l.str === title);
  return ((entry?.analyze ?? a.analyze ?? []) as RawAction[]).map((r) => rawToAction(r, schema)).filter((x): x is Action => !!x);
}

/** 新規パターンの analyze（else として足すか、タイトル1件として足すか） */
export function newPatternAnalyze(mode: 'else' | 'title', sw: string, titleStr: string, actions: Action[], schema: ActionDef[]): AnalyzeItem[] {
  const raw = actionsToAnalyze(actions, schema) as AnalyzeItem[];
  return mode === 'else'
    ? [{ switch: `{$${sw}}`, list: [], else: raw }]
    : [{ switch: `{$${sw}}`, list: [{ str: titleStr.trim(), analyze: raw }], else: [] }];
}
/** switch の list にタイトル1件を足す */
export function addTitleAnalyze(a: Analyzer, str: string, actions: Action[], schema: ActionDef[]): AnalyzeItem[] {
  const entry = { str, analyze: actionsToAnalyze(actions, schema) as AnalyzeItem[] };
  return (a.analyze ?? []).map((it) => ('switch' in it ? { ...it, list: [...(it.list ?? []), entry] } : it));
}
/** else か、そのタイトルのエントリのアクションを差し替える */
export function editAnalyze(a: Analyzer, target: { else: true } | { title: string }, actions: Action[], schema: ActionDef[]): AnalyzeItem[] {
  const raw = actionsToAnalyze(actions, schema) as AnalyzeItem[];
  return (a.analyze ?? []).map((it) => {
    if (!('switch' in it)) return it;
    return 'else' in target ? { ...it, else: raw } : { ...it, list: (it.list ?? []).map((l) => (l.str === target.title ? { ...l, analyze: raw } : l)) };
  });
}
/** else かそのタイトルのエントリを消す。switch が空になればパターンごと消す（empty） */
export function deleteEntryAnalyze(a: Analyzer, target: { else: true } | { title: string }): { analyze: AnalyzeItem[]; empty: boolean } {
  const analyze = (a.analyze ?? []).map((it) => {
    if (!('switch' in it)) return it;
    if ('else' in target) { const { else: _drop, ...rest } = it; return rest as AnalyzeItem; }
    return { ...it, list: (it.list ?? []).filter((l) => l.str !== target.title) };
  });
  const sws = analyze.filter((it) => 'switch' in it);
  return { analyze, empty: sws.length > 0 && sws.every((it) => !(it.list?.length) && !(it.else?.length)) };
}

/** 末尾の種別表記（(アニメ) (TV) (漫画) など）を外す（サーバーの _strip_wiki_title_suffix と同じ） */
export const stripTitleType = (s: string | null | undefined) => (s || '').replace(/\s*\([^)]*(?:アニメ|TV|漫画|映画|劇場版|OVA|ドラマ)[^)]*\)\s*$/, '').trim();
