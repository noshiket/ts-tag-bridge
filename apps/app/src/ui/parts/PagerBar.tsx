import { Pressable, StyleSheet, View } from 'react-native';

import { Chev } from './Icons';
import { T } from './T';
import { useTheme } from '../theme/Tweaks';
import { shadow } from '../theme/edge';
import { useT } from '../i18n/I18n';

/** ページ送り（元の shared.jsx の PagerBar）。1ページで収まる時は出さない。countLabel が無ければ「{n}件」を表示言語で */
export function PagerBar({ page, totalPages, totalCount, countLabel, onPrev, onNext }: {
  page: number;
  totalPages: number;
  totalCount?: number;
  countLabel?: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  if (totalPages <= 1) return null;
  const btn = (disabled: boolean) => [styles.btn, {
    backgroundColor: theme.surface, borderColor: disabled ? theme.line : theme.frame,
    boxShadow: disabled ? undefined : shadow(theme, 2), opacity: disabled ? 0.4 : 1,
  }];
  const first = page === 0;
  const last = page === totalPages - 1;
  return (
    <View style={styles.row}>
      <Pressable onPress={onPrev} disabled={first} style={btn(first)}><Chev s={12} c={theme.ink} d="left" /></Pressable>
      <T mono size={10} dim>
        <T mono w={700} size={10}>{page + 1}</T> / {totalPages}
        {totalCount != null ? <T mono size={9} dim>{`  (${countLabel ? `${totalCount}${countLabel}` : tx('common.count', { n: totalCount })})`}</T> : null}
      </T>
      <Pressable onPress={onNext} disabled={last} style={btn(last)}><Chev s={12} c={theme.ink} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
