// 書体を読む。ラベル類の JetBrains Mono はアプリに入れて使う（Web も同じ名前で読む）。
// 本文は iOS では端末の日本語書体、Web では元の Web 版と同じ Noto Sans JP を Google Fonts から読む
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  JetBrainsMono_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/jetbrains-mono';
import { Platform } from 'react-native';

import type { FaceKey, Theme } from './theme';

const NOTO_SANS_JP = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800;900&display=swap';

export function loadCss(href: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
loadCss(NOTO_SANS_JP);

/**
 * テーマの作風で使う書体。iOS は端末に入っている書体（ヒラギノ明朝は W3/W6、丸ゴシックは W4 だけ）、
 * Web は Google Fonts から、そのテーマを選んだ時だけ読む
 */
export const FACES: Record<FaceKey, { ios: string; web: string; css: string }> = {
  serif: {
    ios: 'Hiragino Mincho ProN',
    web: "'Shippori Mincho B1', 'Noto Serif JP', serif",
    css: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;700;800&display=swap',
  },
  round: {
    ios: 'Hiragino Maru Gothic ProN',
    web: "'Zen Maru Gothic', 'Noto Sans JP', sans-serif",
    css: 'https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700;900&display=swap',
  },
};

/** Web で、テーマの書体の読み込みを始める */
export function loadThemeFaces(theme: Theme) {
  for (const k of [theme.face?.body, theme.face?.heading]) if (k) loadCss(FACES[k].css);
}

/** T の書体: 見出し（12 以上で 800・16 以上で 700）はテーマの見出しの書体、他は本文の書体。無ければ null（端末の書体） */
export function faceFamily(theme: Theme, size: number, w: number): string | null {
  const heading = (size >= 12 && w >= 800) || (size >= 16 && w >= 700);
  const k = (heading && theme.face?.heading) || theme.face?.body;
  return k ? (Platform.OS === 'web' ? FACES[k].web : FACES[k].ios) : null;
}

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    JetBrainsMono_800ExtraBold,
  });
  // 読めなくても画面は出す（端末の等幅書体で代わりに出る）
  return loaded || !!error;
}
