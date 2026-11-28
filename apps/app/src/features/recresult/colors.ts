import { oklch } from '../../ui/theme/oklch';
import type { Theme } from '../../ui/theme/theme';

// 録画結果の札の色（元の recStatusColor / REC_STATE_META と同じ oklch）
const STATUS_HUE: Record<number, number> = { 0: 260, 1: 145, 2: 25, 3: 60 };
/** EDCB の録画の状態の色。明るい画面と暗い画面で明るさを変える。スキップ(4)は無彩色 */
export function recStatusColor(s: number, theme: Theme): string {
  const h = STATUS_HUE[s];
  if (h == null) return theme.mute;
  return theme.isDark ? oklch(0.66, 0.17, h) : oklch(0.58, 0.18, h);
}

const STATE: Record<string, [number, number, number]> = {
  pending: [0.58, 0.04, 250], scanning: [0.6, 0.16, 230], found: [0.58, 0.12, 200], non_file: [0.58, 0.14, 40],
  waiting: [0.58, 0.04, 250], queued: [0.55, 0.18, 280], encoding: [0.65, 0.2, 70], encode_finish: [0.6, 0.17, 150],
  encode_error: [0.6, 0.24, 25], error: [0.6, 0.24, 25], skipped: [0.55, 0.03, 250],
};
/** このアプリの処理の段階の色（知らない段階は薄い色） */
export const recStateColor = (s: string, theme: Theme) => (STATE[s] ? oklch(...STATE[s]!) : theme.mute);

export const ISSUE = oklch(0.72, 0.2, 30);
export const RED = oklch(0.6, 0.22, 25);
export const OK_GREEN = oklch(0.6, 0.15, 135);
export const DUP = oklch(0.6, 0.16, 290);
export const PROTECT = oklch(0.78, 0.16, 210);

/** 実況の勢い（1分あたりのコメント数）の色。20 / 50 / 80 / 110 で黄 → 橙 → 赤 */
export const heatColor = (perMin: number | null, mute: string) =>
  perMin == null ? mute : perMin >= 110 ? '#ff2d55' : perMin >= 80 ? '#ff6b35' : perMin >= 50 ? '#ff9f0a' : perMin >= 20 ? '#ffd60a' : mute;
