import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ManualPlugins } from '../../features/reservations/manual/ManualPlugins';
import { ManualProgramInfo } from '../../features/reservations/manual/ManualProgramInfo';
import { ManualRecSettings } from '../../features/reservations/manual/ManualRecSettings';
import { useManualReserve } from '../../features/reservations/manual/useManualReserve';
import { TabBar } from '../../features/shell/TabBar';
import { Check } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { T } from '../../ui/parts/T';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * 手動予約（元の settings.jsx の ManualReserveScreen）。予約一覧の「手動予約」から開く。このサーバーに入れる（元と同じ）。
 * 日付・時刻は打って入れる（Web の日付・時刻の入力欄の代わり）。入れたら少し待って予約一覧へ戻る。
 * 中身は features/reservations/manual
 */
export default function ManualReserveScreen() {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const back = () => router.replace('/reservations');
  const m = useManualReserve(back);
  const { valid, saved, error } = m;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TopBar title={tx('reservations.list.manual')} onBack={back} />
        <View style={styles.pad}>
          <ManualProgramInfo m={m} />
          <ManualRecSettings m={m} />
          <ManualPlugins m={m} />

          {!valid && <T mono size={10} dim style={styles.mb10}>{tx('screens.manualreserve.enterDateMmDd')}</T>}
          {error && (
            <View style={[styles.err, { backgroundColor: oklch(0.95, 0.05, 25) }]}>
              <T mono size={11} color={oklch(0.4, 0.22, 25)}>{`ERROR: ${error}`}</T>
            </View>
          )}
          <Pressable onPress={() => void m.submit()} disabled={!valid || saved} style={[styles.submit, {
            backgroundColor: saved ? oklch(0.72, 0.2, 135) : valid ? accent.primary : theme.surface2, borderColor: theme.frame,
            boxShadow: saved || !valid ? 'none' : shadow(theme, 3),
          }]}>
            {saved && <Check s={16} c="#fff" w={3} />}
            <T size={14} w={800} color={valid || saved ? '#fff' : theme.mute}>{saved ? tx('screens.manualreserve.reservationAdded') : tx('screens.manualreserve.addReservationAddReserve')}</T>
          </Pressable>
        </View>
      </ScrollView>
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  pad: { paddingHorizontal: 18 },
  mb10: { marginBottom: 10 },
  err: { marginBottom: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 },
  submit: { padding: 14, borderRadius: 14, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
