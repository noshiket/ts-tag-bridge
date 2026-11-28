import { StyleSheet } from 'react-native';

import { oklch } from '../../../ui/theme/oklch';

/** 設定の AMZ で共通の色と形 */
export const AMZ_RED = oklch(0.6, 0.22, 25);

export const amzStyles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  small: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1 },
});
