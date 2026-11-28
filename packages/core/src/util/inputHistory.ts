// 入力欄ごとの履歴（元の Web 版の InputHistory と同じ決め方）。保存は画面の側（端末に置く）

/** 1つの欄に残す数（新しい順） */
export const INPUT_HISTORY_MAX = 20;
/** これより短いものは打ちかけとして残さない */
const MIN_LEN = 2;

export const inputHistoryKey = (k: string) => `tstag_ihist_${k}`;

export function parseInputHistory(raw: string | null): string[] {
  try {
    const a = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(a) ? a.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

/** 残す: 同じものは重ねず先頭へ。短いものは残さない（その時は元のまま返す） */
export function pushInputHistory(list: string[], v: string): string[] {
  const s = (v || '').trim();
  if (s.length < MIN_LEN) return list;
  return [s, ...list.filter((x) => x !== s)].slice(0, INPUT_HISTORY_MAX);
}

/** 候補: 今の値そのものは除き、打っている文字を含むもの（大文字小文字は見ない）を8つまで */
export function inputHistoryCandidates(list: string[], value: string): string[] {
  const q = (value || '').trim().toLowerCase();
  return list.filter((v) => v !== value && (!q || v.toLowerCase().includes(q))).slice(0, 8);
}
