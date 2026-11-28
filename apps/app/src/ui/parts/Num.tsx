import { useEffect } from 'react';
import { Platform, Text, type TextStyle } from 'react-native';

import { loadCss } from '../theme/fonts';
import { useTheme } from '../theme/Tweaks';

// 時刻・話数・勢いの数字。放送の作法どおり、本文より大きく一段太い詰めた書体で出す
// （Web は Google Fonts の Roboto Condensed、iOS は端末の Avenir Next Condensed）
const NUM_CSS = 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@700;800&display=swap';
const NUM_FACE = Platform.OS === 'web' ? "'Roboto Condensed', 'Noto Sans JP', sans-serif" : 'AvenirNextCondensed-Bold';

/** 題名などはテーマの書体（明朝・丸ゴ）に関わらずゴシック。テロップは横線の細い明朝を使わない */
export const GOTHIC: TextStyle = { fontFamily: Platform.OS === 'web' ? "'Noto Sans JP', system-ui, sans-serif" : 'System' };

export function Num({ size, color, style, lines, children }: { size: number; color?: string; style?: TextStyle; lines?: number; children: string }) {
  const { theme } = useTheme();
  useEffect(() => loadCss(NUM_CSS), []);
  return <Text numberOfLines={lines} style={[{ fontFamily: NUM_FACE, fontWeight: '800', fontSize: size, lineHeight: size * 1.05, color: color ?? theme.ink }, style]}>{children}</Text>;
}
