import { StyleSheet } from 'react-native';

import { T } from './T';

/** 区切りの見出し（'番組説明 / DESCRIPTION' など。元の SectionTitle） */
export function SectionTitle({ children }: { children: string }) {
  return <T mono size={10} dim style={styles.t}>{children.toUpperCase()}</T>;
}

const styles = StyleSheet.create({ t: { letterSpacing: 1, marginBottom: 8, marginTop: 4 } });
