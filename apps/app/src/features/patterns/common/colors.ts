// パターン画面の色（元の parse.jsx の GROUP_COLORS と pattern.jsx の状態色。oklch を16進に直したもの）

/** {$1}〜{$4} の色 */
export const GROUP_COLORS = ['#007FFC', '#099C00', '#F84331', '#955BE3'];
export const groupColor = (n: number) => GROUP_COLORS[(n - 1) % GROUP_COLORS.length]!;
/** 完全マッチ / 追加候補 / マッチなし */
export const SC = { matched: '#009D1E', unregistered: '#E66200', nomatch: '#E62B34' };
/** 選び始めの文字・選んでいる範囲 */
export const ANCHOR = '#FF6853';
export const SELECTING = '#FFB255';
