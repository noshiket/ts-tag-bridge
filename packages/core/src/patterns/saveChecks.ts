// 保存前の確かめ: パターンに無いグループを参照していないか、AND条件を引き継ぐか
import type { Analyzer } from './matching';

const groupNums = (p?: string, p2?: string) => new Set([...`${p ?? ''} ${p2 ?? ''}`.matchAll(/\{\$(\d+)\}/g)].map((m) => m[1]!));

/**
 * パターンに無いグループ番号をアクションが参照していないか（[パターン, [番号]] の並び）。
 * セグメンターで番号を付け替えるとアクションの {$N} は元のまま残り、保存すると値が取れない。
 * 入れ子のパターンの子 analyze だけは、その入れ子で取ったグループで見る（textField 等の引数は外側のまま）
 */
export function missingGroupRefs(actions: unknown, pat: string, pat2?: string): [string, string[]][] {
  const miss = new Map<string, Set<string>>();
  const walk = (v: unknown, have: Set<string>, src: string) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\{\$(\d+)\}/g)) if (!have.has(m[1]!)) { if (!miss.has(src)) miss.set(src, new Set()); miss.get(src)!.add(m[1]!); }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, have, src));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.pattern === 'string') {
        const inner = groupNums(o.pattern, o.pattern2 as string | undefined);
        for (const [k, x] of Object.entries(o)) {
          if (k === 'pattern' || k === 'pattern2') continue;
          walk(x, k === 'analyze' ? inner : have, k === 'analyze' ? o.pattern : src);
        }
      } else Object.values(o).forEach((x) => walk(x, have, src));
    }
  };
  walk(actions, groupNums(pat, pat2), pat);
  return [...miss].map(([src, set]) => [src, [...set].sort((a, b) => +a - +b)]);
}
/** 保存前の警告の文（無ければ空） */
export function missingGroupWarning(actions: unknown, pat: string, pat2?: string): string {
  const miss = missingGroupRefs(actions, pat, pat2);
  if (!miss.length) return '';
  return `パターンに無いグループを参照しています: ${miss.map(([src, ns]) => `${ns.map((n) => `{$${n}}`).join(' ')} (pattern: ${JSON.stringify(src)})`).join(' / ')}`
    + '。アクションの参照先を直してください（このまま保存すると値が取れません）。';
}

/**
 * 既存パターンを保存する時の AND条件。画面で組めない時（本文が元の pattern2 に合わずグループを失った等）は元を引き継ぐ。
 * 落とすと「AND条件なしの別パターン」になり pattern2 が消えて見える
 */
export function andConditionForSave(a: Analyzer, enabled: boolean, built: string, source: string): { pattern2?: string; text2?: string } {
  const broken = !!built && !/\{\$\d+\}/.test(built) && /\{\$\d+\}/.test(a.pattern2 || '');
  if (enabled && (!built || broken) && a.pattern2) return { pattern2: a.pattern2, text2: a.text2 };
  return enabled && built ? { pattern2: built, text2: source } : {};
}
