import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** ライブ視聴を始められない時の案内（元の LiveScreen の空の画面） */
export function LiveMessage({ loading, error }: { loading: boolean; error: string | null }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.center}>
        <T size={16} w={700}>{tx('live.liveMessage.live')}</T>
        {!!error && <T size={12} color="#ef4444" style={styles.err}>{`⚠ ${error}`}</T>}
        <T size={13} dim>{loading ? tx('common.loading2') : tx('live.liveMessage.pickProgramAirGuide')}</T>
        <Pressable onPress={() => router.replace('/epg')} style={[styles.btn, { backgroundColor: theme.ink }]}><T size={13} color={theme.onInk}>{tx('live.liveMessage.guide')}</T></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  err: { textAlign: 'center' },
  btn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
});
