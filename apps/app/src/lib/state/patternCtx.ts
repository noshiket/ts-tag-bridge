import type { PatternCtx } from '@tstag/core';

// パターン画面へ渡す番組の情報（元の useApp の patternCtxData）。予約・録画の詳細の「パターン登録 →」で入れてから開く。
// URL に載せるには説明文が長すぎるので、アプリの中で持つ
let current: PatternCtx | null = null;
export const setPatternCtx = (c: PatternCtx | null) => { current = c; };
export const getPatternCtx = () => current;
