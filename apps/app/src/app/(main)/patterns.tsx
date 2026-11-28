import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PatternEditor } from '../../features/patterns/PatternEditor';
import { TabBar } from '../../features/shell/TabBar';
import { getPatternCtx } from '../../lib/state/patternCtx';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** パターン登録の画面（元の pattern.jsx の PatternScreen）。予約・録画の詳細の「パターン登録 →」から開く */
export default function PatternsScreen() {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [ctx] = useState(getPatternCtx);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/reservations'));
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <PatternEditor screen ctx={ctx} topBar={(shoboi) => (
        // 戻るは左（ほかの詳細画面と同じ）。右上だと右のメニューと並んで押し間違えた
        <TopBar title={tx('screens.patterns.patternRegistration')} onBack={back} right={shoboi} />
      )} />
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
