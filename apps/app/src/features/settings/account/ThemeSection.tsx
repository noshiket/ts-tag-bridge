import { Pressable, StyleSheet, View } from 'react-native';

import { Check } from '../../../ui/parts/Icons';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { ACCENTS, THEMES, type AccentKey, type ThemeKey } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 表示テーマ・アクセント・進捗の見せ方（元の SettingsTheme。アカウントに保存） */
export function ThemeSection() {
  const { theme, accent, themeKey, accentKey, progressStyle, setTweak } = useTheme();
  const { t: tx } = useT();
  return (
    <>
      <SectionTitle>{tx('settings.account.theme')}</SectionTitle>
      <View style={styles.themes}>
        {(Object.entries(THEMES) as [ThemeKey, (typeof THEMES)[ThemeKey]][]).map(([k, t]) => {
          const on = themeKey === k;
          return (
            <Pressable key={k} onPress={() => setTweak('theme', k)} style={[styles.themeBtn, {
              backgroundColor: on ? theme.ink : theme.surface, borderColor: theme.frame,
              boxShadow: on ? 'none' : shadow(theme, 3), transform: on && theme.edge === 'offset' ? [{ translateX: 3 }, { translateY: 3 }] : undefined,
            }]}>
              <View style={styles.swatches}>
                {[t.bg, t.surface, t.ink].map((c, i) => <View key={i} style={[styles.swatch, { backgroundColor: c }]} />)}
              </View>
              <T size={11} w={700} color={on ? theme.onInk : theme.ink}>{t.name}</T>
              <T size={9} color={on ? theme.onInk : theme.mute}>{tx(t.note)}</T>
            </Pressable>
          );
        })}
      </View>
      <SectionTitle>{tx('settings.account.accent')}</SectionTitle>
      <View style={styles.accents}>
        {(Object.entries(ACCENTS) as [AccentKey, (typeof ACCENTS)[AccentKey]][]).map(([k, a]) => {
          const on = accentKey === k;
          return (
            <Pressable key={k} onPress={() => setTweak('accent', k)} accessibilityLabel={a.name} style={[styles.accent, {
              backgroundColor: a.primary, borderColor: on ? theme.ink : 'transparent', boxShadow: on ? shadow(theme, 3) : 'none',
            }]}>
              {on && <Check s={18} c="#fff" w={3} />}
            </Pressable>
          );
        })}
      </View>
      <SectionTitle>{tx('settings.account.progress')}</SectionTitle>
      <View style={styles.progress}>
        {([['bar', 'Wave Bar'], ['ring', 'Ring'], ['steps', 'Steps']] as const).map(([k, l]) => {
          const on = progressStyle === k;
          return (
            <Pressable key={k} onPress={() => setTweak('progressStyle', k)}
              style={[styles.chip, { backgroundColor: on ? accent.primary : theme.surface, borderColor: on ? accent.primary : theme.line }]}>
              <T mono size={11} w={700} color={on ? '#fff' : theme.ink}>{l}</T>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  themeBtn: { flexGrow: 1, flexBasis: '30%', padding: 10, borderRadius: 12, borderWidth: 1.5 },
  swatches: { flexDirection: 'row', gap: 3, marginBottom: 5 },
  swatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)' },
  accents: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  accent: { width: 48, height: 48, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1.5 },
});
