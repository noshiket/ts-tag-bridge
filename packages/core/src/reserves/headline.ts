// 予約の見出し（題名・話数・サブタイトル・テレビ欄の印）。予約一覧のテロップ・テレビ欄の表示で使う
import type { Reserve } from './types';

/** 番組名を、テレビ欄の印（[字][再][新] など）と残りに分ける。印は 2 文字までの [ ] だけ */
export function splitTitleMarks(title: string): { title: string; marks: string[] } {
  const marks = [...title.matchAll(/\[([^\]]{1,2})\]/g)].map((m) => m[1]!);
  return { title: title.replace(/\s*\[[^\]]{1,2}\]/g, '').trim(), marks };
}

const firstText = (v: unknown): string => {
  const x = Array.isArray(v) ? v.find((s) => typeof s === 'string' && s) : v;
  return typeof x === 'string' ? x : '';
};

/**
 * 見出し（予約・録画の両方）。解析の確定値があれば作品名・話数・サブタイトルに分け、無ければ番組名から印を外したもの。
 * 複数話は話数を「7・8」とつなぐ
 */
export function reserveHeadline(r: Pick<Reserve, 'title' | 'confirmed'>): { title: string; episode: string; sub: string; marks: string[] } {
  const { title, marks } = splitTitleMarks(r.title);
  const c = r.confirmed ?? {};
  const eps = (Array.isArray(c.episode_number) ? c.episode_number : [c.episode_number]).filter((e): e is string => typeof e === 'string' && !!e);
  return { title: firstText(c.title) || title, episode: eps.join('・'), sub: firstText(c.episode_name), marks };
}
