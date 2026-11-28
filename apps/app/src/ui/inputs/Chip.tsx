import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';

/** 丸い選択肢（元の shared.jsx の Chip）。選ばれていると color で塗る */
export function Chip({ children, color, active, onPress, size = 'md' }: {
  children: ReactNode;
  color?: string;
  active?: boolean;
  onPress?: () => void;
  size?: 'sm' | 'md';
}) {
  const { theme } = useTheme();
  const sm = size === 'sm';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{
      paddingVertical: sm ? 3 : 5, paddingHorizontal: sm ? 8 : 10, borderRadius: 999,
      backgroundColor: active ? (color ?? theme.ink) : theme.surface2,
      borderWidth: 1.5, borderColor: color ?? theme.frame,
    }}>
      <T w={700} size={sm ? 10 : 11} numberOfLines={1} color={active ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

/** 四角いタブ（ライブラリ上部の「アルバム / マイリスト …」）。compact はアルバムの中の「シリーズ / キャプチャ」 */
export function Tab({ label, active, onPress, compact }: { label: string; active: boolean; onPress: () => void; compact?: boolean }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} style={{
      paddingVertical: 6, paddingHorizontal: compact ? 12 : 14, borderRadius: 10, borderWidth: 1.5, borderColor: theme.frame,
      backgroundColor: active ? accent.primary : theme.surface,
    }}>
      <T mono w={700} size={11} color={active ? '#fff' : theme.ink}>{label}</T>
    </Pressable>
  );
}
