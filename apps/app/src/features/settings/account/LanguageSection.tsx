import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';
import { useTheme } from '../../../ui/theme/Tweaks';
import { Card } from '../parts';

/**
 * 表示言語（アカウントに保存）。日本語は本体が持ち、他はサーバーの言語アドオン（設定 → アドオン で入れ外し）。
 * 選んでいる言語のアドオンが無くなった時も、選択肢に残して日本語へ戻せるようにする
 */
export function LanguageSection() {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent, lang, setTweak } = useTheme();
  const q = useQuery({ queryKey: ['i18n', 'languages'], queryFn: () => api.i18n.languages() });
  const list = [{ code: 'ja', label: tx('settings.languageSection.japanese') }, ...(q.data ?? []).map((l) => ({ code: l.code, label: l.label }))];
  if (!list.some((l) => l.code === lang)) list.push({ code: lang, label: lang });
  return (
    <>
      <SectionTitle>{tx('settings.account.language')}</SectionTitle>
      <Card pad>
        <View style={styles.wrap}>
          {list.map((l) => {
            const on = l.code === lang;
            return (
              <Pressable key={l.code} onPress={() => setTweak('lang', l.code)}
                style={[styles.chip, { backgroundColor: on ? accent.primary : theme.surface, borderColor: on ? accent.primary : theme.line }]}>
                <T size={11} w={700} color={on ? '#fff' : theme.ink}>{l.label}</T>
              </Pressable>
            );
          })}
        </View>
        <T size={9} dim style={styles.note}>{tx('settings.account.languageNote')}</T>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1.5 },
  note: { marginTop: 8 },
});
