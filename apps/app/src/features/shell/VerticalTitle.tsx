import { StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';

// 縦書きで向きを変える字（長音・ダッシュ・括弧・三点）
const TATE: Record<string, string> = {
  'ー': '｜', '－': '｜', '-': '｜', '—': '｜', '―': '｜', '…': '︙', '～': '≀', '〜': '≀',
  '（': '︵', '）': '︶', '(': '︵', ')': '︶', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '【': '︻', '】': '︼',
};
const LINE = 12;

/** 題名を縦書きで出す（1 字ずつ縦に積む）。入りきらない時は最後を ︙ にする */
export function VerticalTitle({ text, height, color }: { text: string; height: number; color: string }) {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim()).map((c) => TATE[c] ?? c);
  const n = Math.max(1, Math.floor(height / LINE));
  const shown = chars.length > n ? [...chars.slice(0, n - 1), '︙'] : chars;
  return (
    <View style={[styles.col, { height }]}>
      {shown.map((c, i) => <T key={i} size={11} w={700} color={color} style={styles.ch}>{c}</T>)}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: 16, alignItems: 'center', overflow: 'hidden' },
  ch: { lineHeight: LINE, height: LINE, textAlign: 'center' },
});
