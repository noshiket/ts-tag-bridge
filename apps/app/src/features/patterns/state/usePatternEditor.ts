import {
  ACTION_SCHEMA, actionsToAnalyze, withAddonActions, addTitleAnalyze, analyzeContext, andConditionForSave, baseActionsForNewTitle, buildFetchTextCtx, deleteEntryAnalyze,
  editAnalyze, elseActions, listActions, missingGroupWarning, newPatternAnalyze, segPattern,
  type Action, type Analyzer, type PatternBody, type PatternCtx, type TextSource,
} from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollViewInstance } from 'react-native';

import { usePatternSaved } from './usePatternSaved';
import { useActionSchema } from '../actions/useActionSchema';
import { applyShoboiToActions, shoboiTidOf } from '../shoboi/applyShoboiToActions';
import type { ShoboiApply } from '../shoboi/ShoboiPanel';
import type { TestResult } from '../sections/TestResultPanel';
import { usePatternsForProgram } from './usePatternsForProgram';
import { useBuilderSegments } from './useBuilderSegments';
import { useScrollToPanel } from './useScrollToPanel';
import { useT } from '../../../ui/i18n/I18n';

export type Mode =
  | { type: 'new_pattern'; analyzer?: undefined }
  | { type: 'add_title'; analyzer: Analyzer }
  | { type: 'edit_else'; analyzer: Analyzer }
  | { type: 'edit_list'; analyzer: Analyzer; matchedTitle: string };

const NEW_ACTIONS: Action[] = [
  { type: 'setStr', field: 'title', str: '{$1}' },
  { type: 'setNum', field: 'episode_number', str: '{$2}' },
  { type: 'setStr', field: 'folder', str: '{$1}' },
  { type: 'addList', field: 'category', str: '{$folder}' },
  { type: 'setPath', field: 'app_output_path', str: '' },
];

/** パターン登録の状態と操作（画面は PatternEditor とその部品）。screen はパターン画面の書き方（PatternEditor の説明） */
export function usePatternEditor(ctx: PatternCtx | null, screen?: boolean) {
  const { t: tx } = useT();
  const api = useApi();
  const serverSchema = useActionSchema().picker;
  const schema = screen ? serverSchema : withAddonActions(ACTION_SCHEMA, serverSchema); // 再生画面のタブは元の定義＋アドオンのアクション
  const [saveWarn, setSaveWarn] = useState('');
  /** パターン画面: パターンに無いグループを参照していれば警告して止める */
  const blocked = (analyze: unknown, pat: string, pat2?: string) => {
    if (!screen) return false;
    const w = missingGroupWarning(analyze, pat, pat2);
    setSaveWarn(w);
    return !!w;
  };

  const segs = useBuilderSegments(ctx, screen);
  const { titleSegs, descSegs, extSegs, normalizedTitle, patternsBySource, populate } = segs;

  const [activeTextSource, setActiveTextSource] = useState<TextSource>('$title');
  const [mode, setMode] = useState<Mode | null>(null);
  const activeSegs = activeTextSource === '$description' ? descSegs : activeTextSource === '$extended_info' ? extSegs : titleSegs;
  const builtPattern = segPattern(activeSegs);
  const hasGroups = activeSegs.some((s) => s.group);
  const data = usePatternsForProgram(ctx, normalizedTitle);
  const { sid, reload } = data;

  const [npSwitch, setNpSwitch] = useState('1');
  const [npMode, setNpMode] = useState<'else' | 'title'>('else');
  const [npTitleStr, setNpTitleStr] = useState('');
  const [npActions, setNpActions] = useState<Action[]>(NEW_ACTIONS);
  const [npSaved, setNpSaved] = useState(false);
  const { peerSyncMsg, patternSaved: checkPeerSync } = usePatternSaved();   // 保存の後（連携の失敗・プレビューの取り直し）
  const [editActions, setEditActions] = useState<Action[]>([]);
  const [atStr, setAtStr] = useState('');
  const [atActions, setAtActions] = useState<Action[]>([]);
  const [np2Enabled, setNp2Enabled] = useState(false);
  const [np2Source, setNp2Source] = useState<TextSource>('$description');
  useEffect(() => {
    if (mode?.analyzer?.pattern2 && mode.analyzer.text2) { setNp2Enabled(true); setNp2Source(mode.analyzer.text2 as TextSource); } else { setNp2Enabled(false); setNp2Source('$description'); }
  }, [mode]);
  const [defaultTid, setDefaultTid] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  // 既存パターンの「else編集・＋登録・編集」を押したら、下の編集欄まで動かす（押したことが分かるように）
  const panelScroll = useScrollToPanel(scroll);
  const openPanel = (m: Mode) => { setMode(m); panelScroll.open(); };

  // 入れ子パターンの pattern は、選んでいる文の今のパターンに追従させる
  useEffect(() => {
    setNpActions((prev) => prev.map((a) => (a.type === 'pattern' ? { ...a, pattern: patternsBySource[String(a.text || activeTextSource)] || a.pattern } : a)));
  }, [activeTextSource, builtPattern]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode?.type === 'new_pattern' && npMode === 'title') setNpTitleStr(titleSegs.find((s) => s.group === parseInt(npSwitch, 10))?.text || '');
  }, [npMode, npSwitch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data.configOutputPath) setNpActions((prev) => prev.map((a) => (a.type === 'setPath' && !a.str ? { ...a, str: data.configOutputPath } : a)));
  }, [data.configOutputPath]);

  const fetchCtx = useMemo(() => buildFetchTextCtx(ctx, data.tpContext, [titleSegs, descSegs, extSegs]), [ctx, data.tpContext, titleSegs, descSegs, extSegs]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetToNormal = () => {
    const m = mode;
    setSaveWarn('');
    setMode(null); panelScroll.closed(); setEditActions([]); setAtActions([]); setAtStr('');
    setActiveTextSource('$title'); setNp2Enabled(false); setNp2Source('$description');
    if (m?.type === 'new_pattern') { setNpMode('else'); setNpTitleStr(''); }
    if (m) segs.restore(m.type === 'new_pattern');
  };

  const activeActions = mode?.type === 'new_pattern' ? npActions : mode?.type === 'add_title' ? atActions : editActions;
  const setActiveActions = (fn: (l: Action[]) => Action[]) => {
    if (mode?.type === 'new_pattern') setNpActions(fn); else if (mode?.type === 'add_title') setAtActions(fn); else setEditActions(fn);
  };
  // 欄を開いていない時は新規パターンのアクションへ（元と同じ）
  const shoboiApply = (a: ShoboiApply) => {
    if (a.type === 'tid' || shoboiTidOf(a)) setDefaultTid(shoboiTidOf(a));
    const setter = mode?.type === 'edit_else' || mode?.type === 'edit_list' ? setEditActions : mode?.type === 'add_title' ? setAtActions : setNpActions;
    setter((p) => applyShoboiToActions(p, a));
  };
  // しょぼいのアクションを選んだ時、TID が空ならパネルで選んだ TID を入れる
  // 種類を選び直した時の既定値: しょぼいの TID と、setPath のパス（サーバーの設定の出力パス）。
  // パスは種類を変えた時だけ入れる（入力中に空にしたら、空のままにしておく）
  const withActionDefaults = (prev: Action | undefined, fn: (v: Action) => void) => (v: Action) => {
    if ((v.type === 'getShoboiSubtitle' || v.type === 'getShoboiEpisode') && !v.tid && defaultTid) v = { ...v, tid: defaultTid };
    if (v.type === 'setPath' && prev?.type !== 'setPath' && !v.str && data.configOutputPath) v = { ...v, field: v.field || 'app_output_path', str: data.configOutputPath };
    fn(v);
  };

  const np2Body = (): Partial<PatternBody> => {
    const p = np2Enabled ? patternsBySource[np2Source] : '';
    return p ? { pattern2: p, text2: np2Source } : {};
  };
  const test = async (key: string, body: { analyze: unknown[]; pattern: string; text: string; pattern2?: string; text2?: string }) => {
    const context = analyzeContext(ctx, data.tpContext);
    const sent = { context, pattern: body.pattern, ...(body.pattern2 ? { pattern2: body.pattern2, text2: body.text2 } : {}), text: body.text, analyze: body.analyze };
    const refs = { analyze: body.analyze, pattern: body.pattern, pattern2: body.pattern2 };
    setTestResult({ ctx: key, loading: true });
    try { setTestResult({ ctx: key, result: (await api.patterns.testAnalyze({ ...body, context })).result ?? {}, sent, refs }); } catch (e) { setTestResult({ ctx: key, error: e instanceof Error ? e.message : String(e), sent, refs }); }
  };
  const runTest = () => {
    if (!mode) return;
    const pattern = mode.type === 'new_pattern' ? patternsBySource.$title! : mode.analyzer.pattern;
    if (!pattern) { setTestResult({ ctx: 'active', error: tx('patterns.usePatternEditor.patternUndefined') }); return; }
    void test('active', { analyze: actionsToAnalyze(activeActions, schema), pattern, text: normalizedTitle, ...np2Body() });
  };

  const openAddTitle = (a: Analyzer, suggested = '') => {
    setTestResult(null); setAtStr(suggested);
    setAtActions(baseActionsForNewTitle(a, schema, data.configOutputPath).map((x) => (x.type === 'setStr' && (x.field === 'title' || x.field === 'folder') ? { ...x, str: suggested } : x)));
    populate(a);
    openPanel({ type: 'add_title', analyzer: a });
  };
  const openEditElse = (a: Analyzer) => { setTestResult(null); setEditActions(elseActions(a, schema)); populate(a); openPanel({ type: 'edit_else', analyzer: a }); };
  const openEditList = (a: Analyzer, title: string) => { setTestResult(null); setEditActions(listActions(a, title, schema)); populate(a); openPanel({ type: 'edit_list', analyzer: a, matchedTitle: title }); };

  // AND条件の有無が変わる保存は、元のパターンを潰さず別パターンとして登録する（同じものがあればサーバーがまとめる）
  const saveExisting = async (a: Analyzer, analyze: PatternBody['analyze']) => {
    const p2 = screen ? andConditionForSave(a, np2Enabled, patternsBySource[np2Source] ?? '', np2Source) : np2Body();
    const body = { pattern: a.pattern, analyze, ...p2 };
    if (!!p2.pattern2 !== !!a.pattern2) checkPeerSync(await api.patterns.add(sid!, body));
    else checkPeerSync(await api.patterns.update(sid!, a.pattern_index!, body));
  };
  const confirmAddTitle = async () => {
    if (mode?.type !== 'add_title' || !atStr.trim() || !sid) return;
    if (blocked(actionsToAnalyze(atActions, schema), mode.analyzer.pattern, mode.analyzer.pattern2)) return;
    try { await saveExisting(mode.analyzer, addTitleAnalyze(mode.analyzer, atStr, atActions, schema)); await reload(); } catch { /* 元と同じく黙って戻す */ }
    resetToNormal();
  };
  const saveEdit = async () => {
    if ((mode?.type !== 'edit_else' && mode?.type !== 'edit_list') || !sid) return;
    const target = mode.type === 'edit_else' ? { else: true as const } : { title: mode.matchedTitle };
    if (blocked(actionsToAnalyze(editActions, schema), mode.analyzer.pattern, mode.analyzer.pattern2)) return;
    try { await saveExisting(mode.analyzer, editAnalyze(mode.analyzer, target, editActions, schema)); await reload(); } catch { /* 同上 */ }
    resetToNormal();
  };
  const deleteEntry = async () => {
    if ((mode?.type !== 'edit_else' && mode?.type !== 'edit_list') || !sid) return;
    const a = mode.analyzer;
    const { analyze, empty } = deleteEntryAnalyze(a, mode.type === 'edit_else' ? { else: true } : { title: mode.matchedTitle });
    try {
      if (empty || (screen && !analyze.length)) checkPeerSync(await api.patterns.remove(sid, a.pattern_index!, a));
      else checkPeerSync(await api.patterns.update(sid, a.pattern_index!, { pattern: a.pattern, analyze, ...(a.pattern2 ? { pattern2: a.pattern2, text2: a.text2 } : {}) }));
      await reload();
    } catch { /* 同上 */ }
    resetToNormal();
  };
  const saveNew = async () => {
    if (!hasGroups || !sid || (npMode === 'title' && !npTitleStr.trim())) return;
    if (blocked(actionsToAnalyze(npActions, schema), patternsBySource.$title!, np2Enabled ? patternsBySource[np2Source] : '')) return;
    try {
      checkPeerSync(await api.patterns.add(sid, { pattern: patternsBySource.$title!, analyze: newPatternAnalyze(npMode, npSwitch, npTitleStr, npActions, schema), ...np2Body() }));
      await reload();
      setNpSaved(true);
      setTimeout(() => { setNpSaved(false); resetToNormal(); }, 2000);
    } catch { /* 同上 */ }
  };
  const removeCandidate = async (a: Analyzer) => {
    try { await api.patterns.remove(sid!, a.pattern_index!, a); await reload(); } catch { /* 元と同じく黙る */ }
  };
  const firstGroup = (src: TextSource) => { setActiveTextSource(src); if (!mode) setMode({ type: 'new_pattern' }); };

  return {
    ctx, screen, data, scroll, panelScroll, mode, saveWarn, peerSyncMsg, testResult, test, runTest,
    ...segs, activeTextSource, hasGroups, firstGroup,
    npSwitch, setNpSwitch, npMode, setNpMode, npTitleStr, setNpTitleStr, npSaved, atStr, setAtStr,
    np2Enabled, setNp2Enabled, np2Source, setNp2Source, fetchCtx, activeActions, setActiveActions, withActionDefaults, shoboiApply,
    openAddTitle, openEditElse, openEditList, confirmAddTitle, saveEdit, deleteEntry, saveNew, removeCandidate, resetToNormal,
  };
}

export type PatternEditorState = ReturnType<typeof usePatternEditor>;
