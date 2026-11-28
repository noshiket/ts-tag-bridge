import type { Track } from '@tstag/core';
import { Pressable, StyleSheet } from 'react-native';

import type { MusicLibrary } from './useMusicLibrary';
import { Repeat, Shuffle } from '../../../ui/parts/Icons';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** タブ・並べ方の丸いチップ */
export function MusicChip({ active, onPress, label, style }: { active: boolean; onPress: () => void; label: string; style?: object }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { borderColor: active ? accent.primary : theme.line, backgroundColor: active ? accent.primary : 'transparent' }, style]}>
      <T mono size={10} w={700} color={active ? '#fff' : theme.ink} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

/** タイル表示とリスト表示の切り替え（設定に残す） */
export function ViewToggle() {
  const { theme, musicView: view, setTweak } = useTheme();
  const { t: tx } = useT();
  return (
    <Pressable onPress={() => setTweak('musicView', view === 'grid' ? 'list' : 'grid')} accessibilityLabel={tx(view === 'grid' ? 'library.music.toList' : 'library.music.toGrid')}
      style={[styles.round, { borderColor: theme.line }]}>
      <T size={11}>{view === 'grid' ? '☰' : '⊞'}</T>
    </Pressable>
  );
}

/** 繰り返し: オフ → 全体 → 1曲（1 の印）。絵文字は端末によって □ に化けるので線の絵で */
export function RepeatButton({ m }: { m: MusicLibrary }) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const mode = m.queue.repeat();
  const on = mode !== 'off';
  return (
    <Pressable onPress={() => m.queue.cycleRepeat()} accessibilityLabel={tx(mode === 'off' ? 'library.music.repeatOff' : mode === 'all' ? 'library.music.repeatAll' : 'library.music.repeatOne')}
      style={[styles.round, { borderColor: on ? accent.secondary : theme.line, backgroundColor: on ? accent.secondary : 'transparent' }]}>
      <Repeat c={on ? '#fff' : theme.ink} one={mode === 'one'} />
    </Pressable>
  );
}

/** 並びを混ぜて流す */
export function ShuffleButton({ m, list }: { m: MusicLibrary; list: Track[] }) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  return (
    <Pressable onPress={() => m.shuffle(list)} disabled={!list.length} style={[styles.shuffle, { backgroundColor: list.length ? accent.secondary : theme.line }]}>
      <Shuffle s={12} c="#fff" />
      <T mono size={10} w={800} color="#fff">{tx('library.music.shuffle')}</T>
    </Pressable>
  );
}

export const musicStyles = StyleSheet.create({
  pad: { paddingHorizontal: 18 },
  grow: { flex: 1, minWidth: 0 },
  chips: { gap: 6, paddingBottom: 2 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  newRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  input: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, fontSize: 12 },
  make: { paddingHorizontal: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  plPick: { paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, borderRadius: 9, borderWidth: 1 },
});

const styles = StyleSheet.create({
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1 },
  round: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  shuffle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999 },
});
