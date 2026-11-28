import type { CmMarkDecl } from '@tstag/core';

import { cssColor, oklch } from '../../../ui/theme/oklch';

/**
 * ▼と帯の印の色。テーマの accent は使わない（配色で中身が変わり、組み合わせ次第で同じ色になる。
 * 実際 Coral では SmartCut と見分けられなかった）。色相を離した固定の色（元と同じ）
 */
export const MARK = {
  mute: oklch(0.62, 0.22, 265),
  manual: oklch(0.62, 0.24, 330),
};
/** アドオンが名乗った印の色（名乗らなければ灰）。色はアドオン側が持つ（画面はアドオンを知らない） */
export const markColor = (d: CmMarkDecl) => (d.color ? cssColor(d.color) : '#888');
/** うちの CM 判定（除去される所） */
export const CM_ORANGE = oklch(0.68, 0.19, 60);
/** チャプターの帯の交互の色 */
export const CHAP_A = oklch(0.62, 0.12, 255);
export const CHAP_B = oklch(0.55, 0.1, 255);
