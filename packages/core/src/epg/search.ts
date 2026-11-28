// 番組検索（元の Web 版の search.jsx と同じ決め方）。条件・ジャンルの選び方・送る形・結果の絞り込み
import type { Reserve } from '../reserves/types';
import type { EpgEvent } from './guide';

/** ARIB の大ジャンル（content_nibble = n1*256+255 で大ジャンル全体） */
export const ARIB_GENRES: { v: number; l: string; n1: number }[] = [
  { v: 255, l: 'ニュース', n1: 0 },
  { v: 511, l: 'スポーツ', n1: 1 },
  { v: 767, l: '情報/ワイドショー', n1: 2 },
  { v: 1023, l: 'ドラマ', n1: 3 },
  { v: 1279, l: '音楽', n1: 4 },
  { v: 1535, l: 'バラエティ', n1: 5 },
  { v: 1791, l: '映画', n1: 6 },
  { v: 2047, l: 'アニメ/特撮', n1: 7 },
  { v: 2303, l: 'ドキュメンタリー', n1: 8 },
  { v: 2559, l: '劇場/公演', n1: 9 },
  { v: 2815, l: '趣味/教育', n1: 10 },
  { v: 3071, l: '福祉', n1: 11 },
  { v: 4095, l: 'その他', n1: 15 },
];

/** 中ジャンル（content_nibble = n1*256+n2） */
export const MIDDLE_GENRES: Record<number, [number, string][]> = {
  0: [[0, '定時・総合'], [1, '天気'], [2, '特集・ドキュメント'], [3, '政治・国会'], [4, '経済・市況'], [5, '海外・国際'], [6, '解説'], [7, '討論・会談'], [8, '報道特番'], [9, 'ローカル・地域'], [10, '交通'], [15, 'その他']],
  1: [[0, 'スポーツニュース'], [1, '野球'], [2, 'サッカー'], [3, 'ゴルフ'], [4, 'その他の球技'], [5, '相撲・格闘技'], [6, 'オリンピック・国際大会'], [7, 'マラソン・陸上・水泳'], [8, 'モータースポーツ'], [9, 'マリン・ウィンタースポーツ'], [10, '競馬・公営競技'], [15, 'その他']],
  2: [[0, '芸能・ワイドショー'], [1, 'ファッション'], [2, '暮らし・住まい'], [3, '健康・医療'], [4, 'ショッピング・通販'], [5, 'グルメ・料理'], [6, 'イベント'], [7, '番組紹介・お知らせ'], [15, 'その他']],
  3: [[0, '国内ドラマ'], [1, '海外ドラマ'], [2, '時代劇'], [15, 'その他']],
  4: [[0, '国内ロック・ポップス'], [1, '海外ロック・ポップス'], [2, 'クラシック・オペラ'], [3, 'ジャズ・フュージョン'], [4, '歌謡曲・演歌'], [5, 'ライブ・コンサート'], [6, 'ランキング・リクエスト'], [7, 'カラオケ・のど自慢'], [8, '民謡・邦楽'], [9, '童謡・キッズ'], [10, '民族音楽・ワールドミュージック'], [15, 'その他']],
  5: [[0, 'クイズ'], [1, 'ゲーム'], [2, 'トークバラエティ'], [3, 'お笑い・コメディ'], [4, '音楽バラエティ'], [5, '旅バラエティ'], [6, '料理バラエティ'], [15, 'その他']],
  6: [[0, '洋画'], [1, '邦画'], [2, 'アニメ'], [15, 'その他']],
  7: [[0, '国内アニメ'], [1, '海外アニメ'], [2, '特撮'], [15, 'その他']],
  8: [[0, '社会・時事'], [1, '歴史・紀行'], [2, '自然・動物・環境'], [3, '宇宙・科学・医学'], [4, 'カルチャー・伝統文化'], [5, '文学・文芸'], [6, 'スポーツ'], [7, 'ドキュメンタリー全般'], [8, 'インタビュー・討論'], [15, 'その他']],
  9: [[0, '現代劇・新劇'], [1, 'ミュージカル'], [2, 'ダンス・バレエ'], [3, '落語・演芸'], [4, '歌舞伎・古典'], [15, 'その他']],
  10: [[0, '旅・釣り・アウトドア'], [1, '園芸・ペット・手芸'], [2, '音楽・美術・工芸'], [3, '囲碁・将棋'], [4, '麻雀・パチンコ'], [5, '車・オートバイ'], [6, 'コンピュータ・TVゲーム'], [7, '会話・語学'], [8, '幼児・小学生'], [9, '中学生・高校生'], [10, '大学生・受験'], [11, '生涯教育・資格'], [12, '教育問題'], [15, 'その他']],
  11: [[0, '高齢者'], [1, '障害者'], [2, '社会福祉'], [3, 'ボランティア'], [4, '手話'], [5, '文字（字幕）'], [6, '音声解説'], [15, 'その他']],
};

export interface SearchQuery {
  andkey: string; notkey: string;
  regExp: boolean; aimai: boolean; titleOnly: boolean; archive: boolean;
  /** 'onid-tsid-sid' */
  serviceList: string[];
  contentList: number[]; notContent: boolean;
  /** 0 全て・1 無料のみ・2 有料のみ */
  freeCaFlag: 0 | 1 | 2;
  durationMin: number; durationMax: number;
  /** 0 は全期間 */
  days: number;
}

export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  andkey: '', notkey: '',
  regExp: false, aimai: false, titleOnly: false, archive: false,
  serviceList: [], contentList: [], notContent: false,
  freeCaFlag: 0,
  durationMin: 0, durationMax: 0,
  days: 7,
};

/** 端末に残した条件を読む（足りない項目は既定で埋める） */
export function parseSearchQuery(raw: string | null): SearchQuery {
  try {
    const o = JSON.parse(raw || 'null') as Partial<SearchQuery> | null;
    if (o && typeof o === 'object') return { ...DEFAULT_SEARCH_QUERY, ...o };
  } catch { /* 壊れていたら既定 */ }
  return { ...DEFAULT_SEARCH_QUERY };
}

const subsOf = (n1: number) => (MIDDLE_GENRES[n1] ?? []).map(([n2]) => n1 * 256 + n2);

/** 大ジャンルを押す: 中ジャンルが1つでも選ばれていれば全部外し、無ければ全部入れる（中ジャンルの無い「その他」はそれ自体を切り替える） */
export function toggleLargeGenre(list: number[], g: { v: number; n1: number }): number[] {
  const subs = subsOf(g.n1);
  if (!subs.length) return list.includes(g.v) ? list.filter((x) => x !== g.v) : [...list, g.v];
  return subs.some((v) => list.includes(v)) ? list.filter((v) => !subs.includes(v)) : [...list, ...subs.filter((v) => !list.includes(v))];
}

/** 大ジャンルの選ばれ方（何個・全部か・どれかか） */
export function largeGenreSelection(list: number[], g: { v: number; n1: number }) {
  const subs = subsOf(g.n1);
  const count = subs.length ? subs.filter((v) => list.includes(v)).length : list.includes(g.v) ? 1 : 0;
  return { count, all: subs.length ? count === subs.length : count === 1, any: count > 0 };
}

/** 中ジャンルを開いて見せる大ジャンル（中ジャンルがどれか選ばれているもの） */
export const expandedGenres = (list: number[]) => ARIB_GENRES.filter((g) => subsOf(g.n1).some((v) => list.includes(v)));

/** 送る前に、中ジャンルが全部選ばれている大ジャンルは大ジャンルの値（n2=0xFF）にまとめる */
export function normalizeContentList(list: number[]): number[] {
  let out = [...list];
  for (const g of ARIB_GENRES) {
    const subs = subsOf(g.n1);
    if (subs.length && subs.every((v) => out.includes(v))) out = [...out.filter((v) => !subs.includes(v)), g.v];
  }
  return out;
}

/** GET /api/search の問い合わせ（指定の無い項目は送らない） */
export function searchParams(q: SearchQuery): string {
  const p = new URLSearchParams();
  if (q.andkey) p.set('and_key', q.andkey);
  if (q.notkey) p.set('not_key', q.notkey);
  if (q.regExp) p.set('reg_exp_flag', '1');
  if (q.titleOnly) p.set('title_only_flag', '1');
  if (q.aimai) p.set('aimai_flag', '1');
  if (q.archive) p.set('archive', '1');
  if (q.days) p.set('days', String(q.days));
  if (q.freeCaFlag) p.set('free_ca_flag', String(q.freeCaFlag));
  if (q.durationMin) p.set('chk_duration_min', String(q.durationMin));
  if (q.durationMax) p.set('chk_duration_max', String(q.durationMax));
  q.serviceList.forEach((s) => p.append('service', s));
  normalizeContentList(q.contentList).forEach((c) => p.append('content', String(c)));
  if (q.notContent) p.set('not_content_flag', '1');
  return p.toString();
}

/** 大ジャンルの名前（検索の一覧の札） */
export function searchGenreLabel(cn: number | null | undefined): string {
  if (cn == null) return '';
  return ARIB_GENRES.find((g) => g.n1 === cn >> 8)?.l ?? '';
}

const pad = (n: number) => String(n).padStart(2, '0');
const local = (ms: number) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** 一覧の時刻 'MM-DD HH:mm · N分' と、シートの時刻 'MM-DD HH:mm — HH:mm (N分)'（元と同じ） */
export function searchTimes(e: Pick<EpgEvent, 'start_time' | 'duration_sec'>) {
  const start = Date.parse(e.start_time);
  const min = Math.round((e.duration_sec || 0) / 60);
  const end = start + (e.duration_sec || 0) * 1000;
  return { list: `${local(start)} · ${min}分`, sheet: `${local(start)} — ${local(end).slice(6)} (${min}分)`, end };
}

/** 「現在以降」: 終わっていない番組 */
export const futureResults = (rs: EpgEvent[], now = Date.now()) => rs.filter((r) => searchTimes(r).end > now);

/** 検索の一覧は予約を題名で見る（元と同じ。同じ題名の予約があれば REC） */
export const reserveByTitle = (reserves: Reserve[], title: string) => reserves.find((r) => r.title === title);
