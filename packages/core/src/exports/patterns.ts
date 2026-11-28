// パターン（番組名の解析）の外へ出す名前（index.ts からまとめて出す）
export { applyAnalyze, choosePreview, mockParse, patternToRegex, withAddedTitle } from '../patterns/parse';
export type { AnalyzeItem, Groups, ParsePreview, Pattern, ServerParse } from '../patterns/parse';
export { ACTION_SCHEMA, CONTEXT_REFS, OUTPUT_FIELDS, PATH_CONTEXT_VARS, TEMPLATE_PLACEHOLDERS, actionFieldValues, actionsToAnalyze, defaultActions, rawToAction, withAddonActions } from '../patterns/actions';
export type { Action, ActionDef, ActionParam, RawAction } from '../patterns/actions';
export { PATH_TEMPLATE_RULES, PATH_VAR_GROUPS, expandPathExample } from '../patterns/pathVars';
export type { PathVar, PathVarGroup } from '../patterns/pathVars';
export {
  addTitleAnalyze, analyzeContext, andConditionForSave, missingGroupRefs, missingGroupWarning, assignGroup, baseActionsForNewTitle, buildFetchTextCtx, deleteEntryAnalyze, editAnalyze, elseActions, findPatternsByString, freeGroups,
  initSegs, listActions, matchPattern2, matchedPatterns, newPatternAnalyze, removeGroup, segPattern, segText, segmentsFromPattern, segmentsFromPattern2, stripTitleType, withSeconds,
} from '../patterns/builder';
export type { Analyzer, MatchedPattern, PatternCtx, Segment, ServerMatch, TextSource, FetchTextCtx } from '../patterns/builder';
export type { PatternBody, PeerSync, ShoboiProgram, ShoboiTitleHit, AddonSearchHit } from '../patterns/api';
