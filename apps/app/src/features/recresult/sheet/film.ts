import { Platform } from 'react-native';

import { loadCss } from '../../../ui/theme/fonts';
import { useTheme } from '../../../ui/theme/Tweaks';

/** テーマに関わらない色（エンコ済の緑・赤ペン・未処理の札・同じ回の札の地） */
export const FILM = { done: '#2FB36B', pen: '#E8432E', idle: '#E9E9E9', chip: '#2C2C2C' };

/** フィルムの地・送り穴・文字はテーマの色から。縁の文字（フィルムの縁の刷り込みの橙）は明るい地では濃くする */
export function useFilm() {
  const { theme } = useTheme();
  return {
    base: theme.surface, roll: theme.surface2, hole: theme.line, text: theme.ink, sub: theme.mute, track: theme.line,
    edge: theme.isDark ? '#E58A2B' : '#A8530A',
  };
}

// 赤ペンの書き込みの書体（Web は Google Fonts の Permanent Marker、iOS は端末の Marker Felt）
const PEN_CSS = 'https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap';
export const PEN_FACE = Platform.OS === 'web' ? "'Permanent Marker', 'Noto Sans JP', sans-serif" : 'MarkerFelt-Wide';
export const loadPenFace = () => loadCss(PEN_CSS);
