// 題名のパターン解析の見本（元の Web 版の helpers.jsx の patternToRegex / applyAnalyze / mockParse と同じ）。
// 本当に採用される結果はサーバー（text_parser）が出す。ここは「どの部分がどの {$n} に当たるか」と、
// 構造は合うが switch に未登録の値を見つけるための簡易版

/** パターン1件（GET /api/patterns?sid=） */
export interface Pattern {
  index?: number;
  pattern: string;
  analyze?: AnalyzeItem[];
  [k: string]: unknown;
}
export type AnalyzeItem = Record<string, unknown> & {
  switch?: string;
  list?: { str: string; analyze: AnalyzeItem[] }[];
  else?: AnalyzeItem[];
};

/** 'タイトル #{$2}' の {$n} を捕まえる正規表現にする（最後の {$n} は貪欲、他は最短） */
export function patternToRegex(pattern: string): RegExp {
  const nums = [...pattern.matchAll(/\{\$(\d+)\}/g)].map((m) => +m[1]!);
  const parts = pattern.split(/\{\$\d+\}/);
  let re = '^';
  parts.forEach((p, i) => {
    re += p.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    if (i < nums.length) re += i === nums.length - 1 ? '(.+)' : '(.+?)';
  });
  return new RegExp(`${re}$`);
}

/** {$n} に当たった文字（g1, g2, …） */
export type Groups = Record<string, string>;

const groupsOf = (pattern: string, m: RegExpMatchArray): Groups => {
  const g: Groups = {};
  [...pattern.matchAll(/\{\$(\d+)\}/g)].forEach((x, i) => { g[`g${x[1]}`] = m[i + 1]!; });
  return g;
};

/** analyze の setStr / setNum / addList を当てはめる（SID から引く物は「引く予定」の印だけ） */
export function applyAnalyze(items: AnalyzeItem[], groups: Groups): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // str を持たない項目もある（{"addList":"category"} など）。サーバーと同じく空文字として扱う
  const fill = (s: unknown) => String(s ?? '').replace(/\{\$(\d+)\}/g, (_x, n: string) => groups[`g${n}`] ?? '');
  for (const it of items) {
    if ('setStr' in it) result[String(it.setStr)] = fill(it.str);
    if ('setNum' in it) result[String(it.setNum)] = parseInt(fill(it.str), 10) || fill(it.str);
    if ('getFromSid' in it) result._sid_lookup = true;
    if ('getEpisodeFromSid' in it) result._sid_ep_lookup = true;
    if ('addList' in it) {
      const val = fill(it.str).replace(/\{\$([a-zA-Z_]\w*)\}/g, (m, k: string) => (result[k] as string | undefined) ?? m);
      const f = String(it.addList);
      result[f] = Array.isArray(result[f]) ? [...(result[f] as unknown[]), val] : [val];
    }
  }
  return result;
}

export type ParsePreview =
  | { status: 'matched'; pattern: string; groups: Groups; result: Record<string, unknown> }
  | { status: 'unregistered'; pattern: string; groups: Groups; newValue: string }
  | { status: 'nomatch' };

/** 簡易の解析: 最初に構造が合うパターンで、switch の値が登録済みなら結果、未登録なら「未登録」 */
export function mockParse(title: string, patterns: Pattern[]): ParsePreview {
  for (const a of patterns) {
    const m = title.match(patternToRegex(a.pattern));
    if (!m) continue;
    const groups = groupsOf(a.pattern, m);
    const top = a.analyze || [];
    for (const it of top) {
      if (typeof it.switch !== 'string') continue;
      const v = it.switch.match(/\{\$(\d+)\}/)?.[1];
      const val = v ? groups[`g${v}`] ?? '' : '';
      const found = it.list?.find((l) => l.str === val);
      if (found) return { status: 'matched', pattern: a.pattern, groups, result: applyAnalyze(found.analyze, groups) };
      if (it.else) return { status: 'matched', pattern: a.pattern, groups, result: applyAnalyze(it.else, groups) };
      return { status: 'unregistered', pattern: a.pattern, groups, newValue: val };
    }
    return { status: 'matched', pattern: a.pattern, groups, result: applyAnalyze(top, groups) };
  }
  return { status: 'nomatch' };
}

/** POST /api/patterns/preview の答え（実際に採用される結果） */
export interface ServerParse {
  status: 'matched' | 'nomatch' | string;
  matched_pattern?: string;
  result?: Record<string, unknown>;
}

/**
 * 出す結果を決める（元と同じ順）: サーバーで採用されたもの → どれも採用されず構造だけ合うもの（登録の手伝い）→
 * マッチなし → サーバーに届かなかった時は簡易版。
 * 採用されたものの {$n} は、採用されたパターンで NFKC にそろえて当て直す（表示用）
 */
export function choosePreview(normTitle: string, server: ServerParse | null, mock: ParsePreview): ParsePreview {
  if (server?.status === 'matched' && server.matched_pattern) {
    const nfkc = (s: string) => s.normalize('NFKC');
    let groups: Groups = {};
    try {
      const m = nfkc(normTitle).match(patternToRegex(nfkc(server.matched_pattern)));
      if (m) groups = groupsOf(server.matched_pattern, m);
    } catch { /* 表示用なので当て直せなくてもよい */ }
    return { status: 'matched', pattern: server.matched_pattern, result: server.result || {}, groups };
  }
  if (mock.status === 'unregistered') return mock;
  if (server?.status === 'nomatch') return { status: 'nomatch' };
  return mock;
}

/** 未登録の値を switch に足した見本のパターン一覧を作る（元の「パターンに追加」。保存はしない） */
export function withAddedTitle(patterns: Pattern[], pattern: string, value: string, fields: { title: string; folder: string; type: string }): Pattern[] {
  const analyze: AnalyzeItem[] = [
    { setStr: 'title', str: fields.title || value },
    ...(fields.folder ? [{ setStr: 'folder', str: fields.folder }] : []),
    ...(fields.type ? [{ setStr: 'type', str: fields.type }] : []),
    { setNum: 'episode', str: '{$2}' },
  ];
  const idx = patterns.findIndex((a) => a.pattern === pattern);
  if (idx < 0) return [...patterns, { pattern, index: patterns.length, analyze: [{ switch: '{$1}', list: [{ str: value, analyze }] }] }];
  return patterns.map((a, i) => i !== idx ? a : {
    ...a, analyze: (a.analyze || []).map((it) => ('switch' in it ? { ...it, list: [...(it.list || []), { str: value, analyze }] } : it)),
  });
}
