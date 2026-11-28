import { Pressable, StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Card } from '../parts';
import { useT } from '../../../ui/i18n/I18n';

const ROWS = [
  { key: 'reserveView', label: 'settings.account.listView.reserve', options: [['card', 'view.card'], ['poster', 'view.poster'], ['table', 'view.table']] },
  { key: 'recView', label: 'settings.account.listView.rec', options: [['card', 'view.card'], ['qc', 'view.qc'], ['sheet', 'view.sheet']] },
  { key: 'albumView', label: 'settings.account.listView.album', options: [['card', 'view.card'], ['tile', 'view.tile'], ['stack', 'view.stack']] },
] as const;

/** 一覧の表示（予約・録画結果・アルバム）。アカウントに保存し、一覧の画面では切り替えない */
export function ListViewSection() {
  const tw = useTheme();
  const { theme, accent, setTweak } = tw;
  const { t: tx } = useT();
  return (
    <>
      <SectionTitle>{tx('settings.account.listView')}</SectionTitle>
      <Card pad>
        {ROWS.map((row, i) => (
          <View key={row.key} style={i < ROWS.length - 1 && styles.mb12}>
            <T size={10} w={700} style={styles.mb5}>{tx(row.label)}</T>
            <View style={styles.wrap}>
              {row.options.map(([k, l]) => {
                const on = tw[row.key] === k;
                return (
                  <Pressable key={k} onPress={() => setTweak(row.key, k)}
                    style={[styles.chip, { backgroundColor: on ? accent.primary : theme.surface, borderColor: on ? accent.primary : theme.line }]}>
                    <T size={11} w={700} color={on ? '#fff' : theme.ink}>{tx(l)}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  mb5: { marginBottom: 5 },
  mb12: { marginBottom: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1.5 },
});
