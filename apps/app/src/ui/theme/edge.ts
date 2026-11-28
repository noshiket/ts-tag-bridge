import type { ViewStyle } from 'react-native';

import type { Theme } from './theme';

/**
 * 部品の影（テーマの作風に従う）。offset は元の Web 版の「ずらした影」（ぼかし 0・不透明）、
 * soft はぼかした薄い影、flat は影なし。n はずらす量（2・3・4）。color は offset の時だけ使う
 */
export function shadow(theme: Theme, n: number, color: string = theme.frame): string {
  if (theme.edge === 'offset') return `${n}px ${n}px 0px ${color}`;
  if (theme.edge === 'soft') return `0px ${n - 1}px ${n * 3}px ${theme.shade ?? 'rgba(0,0,0,0.12)'}`;
  return 'none';
}

/** 元の Web 版の「太い枠 + ずらした影」（border 1.5px + box-shadow 3px 3px 0）。作風に従って枠の色と影が変わる */
export function brutal(theme: Theme, offset = 3, color = theme.frame): ViewStyle {
  return { borderWidth: 1.5, borderColor: color, boxShadow: shadow(theme, offset, color) };
}
