import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Mark } from '../../ui/parts/Mark';
import { T } from '../../ui/parts/T';

/** ビデオカードの上の段の小さな札（MP4・字・drop など） */
export function Badge({ bg, fg, bold, children }: { bg: string; fg: string; bold?: boolean; children: ReactNode }) {
  return (
    <Mark bg={bg} fg={fg} style={styles.badge}>
      {(c) => <T mono size={8} w={bold ? 700 : 400} color={c} numberOfLines={1}>{children}</T>}
    </Mark>
  );
}

const styles = StyleSheet.create({ badge: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 } });
