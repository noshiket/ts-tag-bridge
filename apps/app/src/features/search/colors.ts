import { oklch } from '../../ui/theme/oklch';

// 番組検索のジャンルの色（元の search.jsx の _GENRE_BG / _GENRE_INK。番組表の色とは別で、暗い画面でも同じ）
const BG: Record<number, [number, number, number]> = {
  0: [0.88, 0.08, 210], 1: [0.88, 0.1, 130], 2: [0.88, 0.08, 55], 3: [0.88, 0.1, 30], 4: [0.88, 0.1, 310], 5: [0.9, 0.11, 80],
  6: [0.85, 0.11, 15], 7: [0.88, 0.1, 190], 8: [0.88, 0.09, 150], 9: [0.88, 0.09, 280], 10: [0.9, 0.09, 100], 11: [0.88, 0.06, 150],
  15: [0.88, 0.02, 0],
};
const INK: Record<number, [number, number, number]> = {
  0: [0.3, 0.18, 240], 1: [0.3, 0.16, 140], 2: [0.35, 0.14, 60], 3: [0.32, 0.18, 30], 4: [0.35, 0.2, 310], 5: [0.35, 0.16, 60],
  6: [0.3, 0.2, 15], 7: [0.32, 0.18, 200], 8: [0.3, 0.14, 160], 9: [0.32, 0.16, 280], 10: [0.3, 0.12, 110], 11: [0.3, 0.1, 150],
  15: [0.4, 0.02, 0],
};

/** 大ジャンル（n1）の地と文字の色 */
export const genreBg = (n1: number) => oklch(...(BG[n1] ?? BG[15]!));
export const genreInk = (n1: number) => oklch(...(INK[n1] ?? INK[15]!));
/** 番組の content_nibble から（無ければ「その他」） */
export const searchGenreStyle = (cn: number | null | undefined) => {
  const n1 = cn != null ? cn >> 8 : 15;
  return { bg: genreBg(n1), ink: genreInk(n1) };
};
