import { GENRE_LABEL, type Genre } from '@tstag/core';

import { oklch } from '../../ui/theme/oklch';
import type { Theme } from '../../ui/theme/theme';

// 番組表の色（元の epg.jsx / queue.jsx の GENRE_STYLE と _genreStyle と同じ oklch）
const HUE: Record<Genre, number> = { news: 210, doc: 150, drama: 30, var: 80, music: 310, sport: 130, movie: 15, anime: 190, kids: 75, edu: 220 };
const POP: Record<Genre, [[number, number, number], [number, number, number]]> = {
  news: [[0.88, 0.08, 210], [0.35, 0.18, 240]], doc: [[0.88, 0.09, 150], [0.3, 0.14, 160]], drama: [[0.88, 0.1, 30], [0.32, 0.18, 30]],
  var: [[0.9, 0.11, 80], [0.35, 0.16, 60]], music: [[0.88, 0.1, 310], [0.35, 0.2, 310]], sport: [[0.88, 0.1, 130], [0.3, 0.16, 140]],
  movie: [[0.85, 0.11, 15], [0.3, 0.2, 15]], anime: [[0.88, 0.1, 190], [0.32, 0.18, 200]], kids: [[0.9, 0.12, 75], [0.35, 0.18, 60]],
  edu: [[0.88, 0.09, 220], [0.32, 0.16, 230]],
};
const cache = new Map<string, GenreStyle>();

export interface GenreStyle { bg: string; ink: string; label: string; /** 左端の色線（細線のテーマ。地は塗らずにジャンルをここで出す） */ bar?: string }

/**
 * 番組の地の色と文字の色。明るい画面は元の配色、暗い画面は暗い地に鮮やかな字、Mono は彩度を落とす。
 * Paper はテレビ欄の紙の地に色線、Soft は淡いパステル、Cinema は黒に近い地に色線
 */
export function genreStyle(g: Genre, theme: Theme): GenreStyle {
  const key = `${g}:${theme.name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = HUE[g];
  const label = GENRE_LABEL[g];
  const out: GenreStyle = theme.name === 'Paper' ? { bg: oklch(0.975, 0.012, h), ink: theme.ink, bar: oklch(0.58, 0.11, h), label }
    : theme.name === 'Soft' ? { bg: oklch(0.94, 0.045, h), ink: oklch(0.36, 0.09, h), label }
      : theme.name === 'Cinema' ? { bg: oklch(0.2, 0.012, h), ink: theme.ink, bar: oklch(0.62, 0.1, h), label }
        : theme.isDark ? { bg: oklch(0.3, 0.085, h), ink: oklch(0.9, 0.11, h), label }
          : theme.name === 'Mono Pop' ? { bg: oklch(0.91, 0.018, h), ink: oklch(0.34, 0.03, h), label }
            : { bg: oklch(...POP[g][0]), ink: oklch(...POP[g][1]), label };
  cache.set(key, out);
  return out;
}

/** 番組の枠の作り（テーマの枠の作風に合わせる）: 太枠のテーマは元のまま、細線は角を立てて細い線、Soft は枠なしの丸角に影 */
export function cellLook(theme: Theme) {
  if (theme.edge === 'flat') return { radius: 2, border: 1, borderColor: theme.cardFrame, shadow: undefined };
  if (theme.edge === 'soft') return { radius: 10, border: 0, borderColor: 'transparent', shadow: `0px 2px 6px ${theme.shade ?? 'rgba(0,0,0,0.12)'}` };
  return { radius: 7, border: 1.5, borderColor: theme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.25)', shadow: undefined };
}

/** 番組の印の色（字・再・解・デ・二・新） */
export const FLAG_COLOR: Record<string, string> = {
  字: oklch(0.62, 0.22, 25), 再: oklch(0.55, 0.18, 280), 解: oklch(0.6, 0.16, 200), デ: oklch(0.55, 0.2, 145), 二: oklch(0.55, 0.2, 320), 新: oklch(0.62, 0.22, 60),
};

/** 実況の勢いの色（KonomiTV の閾値: 500 祭り / 200 / 100） */
export const forceColor = (f: number) => (f >= 500 ? '#ff2d55' : f >= 200 ? '#ff6b35' : f >= 100 ? '#ff9f0a' : '#9aa0a6');

/** 局の見出しの帯の色 */
export const bandColor = (hue: number, theme: Theme) =>
  theme.name === 'Mono Pop' ? oklch(0.55, 0.035, hue)
    : theme.name === 'Paper' ? oklch(0.42, 0.05, hue)
      : theme.name === 'Soft' ? oklch(0.62, 0.09, hue)
        : theme.name === 'Cinema' ? oklch(0.32, 0.04, hue)
          : theme.isDark ? oklch(0.45, 0.13, hue) : oklch(0.62, 0.17, hue);
