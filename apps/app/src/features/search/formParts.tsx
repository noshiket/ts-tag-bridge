import { ARIB_GENRES, MIDDLE_GENRES, expandedGenres, largeGenreSelection, toggleLargeGenre } from '@tstag/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { genreBg, genreInk } from './colors';
import { useT } from '../../ui/i18n/I18n';

// 番組検索と自動予約の編集で同じ形の入力（元の search.jsx と auto_reserve.jsx は同じ見た目で別々に書いてあった）

/** 項目名（API の名前と、薄い説明）。説明の薄さは画面で違う（検索 0.6・自動予約 0.5） */
export function Field({ k, l, subOpacity = 0.6, children }: { k: string; l?: string; subOpacity?: number; children?: ReactNode }) {
  return (
    <T mono size={9} dim style={styles.field}>
      {k}{l ? <T mono size={9} dim style={{ opacity: subOpacity }}>{` ${l}`}</T> : null}{children}
    </T>
  );
}

/** 丸い切り替え（選ぶと color で塗る） */
export function ToggleChip({ children, on, color, onPress }: { children: ReactNode; on: boolean; color: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: on ? color : 'transparent', borderColor: on ? color : theme.line }]}>
      <T mono size={10} w={700} color={on ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

/** 横の「✕ クリア」 */
export function ClearLink({ onPress }: { onPress: () => void }) {
  const { t: tx } = useT();
  return <Pressable onPress={onPress}><T size={9} dim>{tx('search.formParts.clear')}</T></Pressable>;
}

/**
 * ジャンル（大ジャンルを押すと中ジャンルを全部。どれか選ぶと下に中ジャンルを開く）。
 * 選んでいる間は見出しの横に「NOT扱い」と「✕ クリア」
 */
export function GenrePicker({ label, list, onChange, not, onNot }: {
  label: ReactNode;
  list: number[];
  onChange: (list: number[]) => void;
  not: boolean;
  onNot: (v: boolean) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const toggle = (v: number) => onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <View>
      <View style={styles.row}>
        {label}
        {list.length > 0 && (
          <>
            <Pressable onPress={() => onNot(!not)}
              style={[styles.notBtn, { backgroundColor: not ? accent.secondary : 'transparent', borderColor: not ? accent.secondary : theme.line }]}>
              <T mono size={9} w={700} color={not ? '#fff' : theme.mute}>{tx('search.formParts.treat')}</T>
            </Pressable>
            <ClearLink onPress={() => { onChange([]); onNot(false); }} />
          </>
        )}
      </View>
      <View style={[styles.wrap4, styles.mb4]}>
        {ARIB_GENRES.map((g) => {
          const s = largeGenreSelection(list, g);
          return (
            <Pressable key={g.v} onPress={() => onChange(toggleLargeGenre(list, g))} style={[styles.genre, {
              backgroundColor: s.all ? genreBg(g.n1) : 'transparent',
              borderColor: s.any ? genreInk(g.n1) : theme.line, borderStyle: s.any && !s.all ? 'dashed' : 'solid',
            }]}>
              <T mono size={10} w={700} color={s.any ? genreInk(g.n1) : theme.ink}>{g.l}{s.any && !s.all ? ` (${s.count})` : ''}</T>
            </Pressable>
          );
        })}
      </View>
      {expandedGenres(list).map((g) => (
        <View key={g.n1} style={[styles.middle, { borderLeftColor: genreInk(g.n1) }]}>
          <T mono size={8} color={genreInk(g.n1)} style={styles.mb3}>{tx('search.formParts.subgenre', { v0: g.l })}</T>
          <View style={styles.wrap3}>
            {(MIDDLE_GENRES[g.n1] ?? []).map(([n2, l]) => {
              const v = g.n1 * 256 + n2;
              const sel = list.includes(v);
              return (
                <Pressable key={v} onPress={() => toggle(v)}
                  style={[styles.sub, { backgroundColor: sel ? genreBg(g.n1) : 'transparent', borderColor: sel ? genreInk(g.n1) : theme.line }]}>
                  <T mono size={9} w={700} color={sel ? genreInk(g.n1) : theme.mute}>{l}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

export const formStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  wrap5: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
});

const styles = StyleSheet.create({
  field: { marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1.5 },
  notBtn: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999, borderWidth: 1.5, marginBottom: 4 },
  wrap4: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  wrap3: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mb3: { marginBottom: 3 },
  mb4: { marginBottom: 4 },
  genre: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1.5 },
  middle: { marginTop: 4, paddingLeft: 8, borderLeftWidth: 2 },
  sub: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, borderWidth: 1 },
});
