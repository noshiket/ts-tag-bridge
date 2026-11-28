import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import '../lib/device/noInputZoom';
import { usePageColor } from '../lib/device/pageColor';
import { persistOffline, seedOffline } from '../lib/device/offlineCache';
import { makeQueryClient } from '../lib/lifecycle/queryClient';
import { ViewNodeProvider } from '../lib/state/viewNode';
import { SessionProvider, useSession } from '../session/SessionProvider';
import { useAppFonts } from '../ui/theme/fonts';
import { TweaksProvider, useTheme } from '../ui/theme/Tweaks';
import { BootScreen } from '../ui/parts/BootScreen';
import { I18nProvider } from '../ui/i18n/I18n';
import { clearShareCache } from '../lib/device/downloadShare';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // 通信が無い時のために、前に受け取った自分（画面の許可）と好み（テーマ）を仮に入れておく
  const [queryClient] = useState(() => { const qc = makeQueryClient(); seedOffline(qc); persistOffline(qc); return qc; });
  return (
    // つまむ・なぞる操作（番組表の拡大縮小など）を受けるための入れ物
    <GestureHandlerRootView style={styles.root}>
      <SessionProvider queryClient={queryClient}>
        <TweaksProvider>
          <I18nProvider>
            <ViewNodeProvider>
              <RootStack />
            </ViewNodeProvider>
          </I18nProvider>
        </TweaksProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

function RootStack() {
  const { status } = useSession();
  const fontsReady = useAppFonts();
  const { theme, accent } = useTheme();
  const ready = status !== 'loading' && fontsReady;
  usePageColor(theme.bg);
  // 動かない起動画面は JS が動いたらすぐ消し、ログインしたままかどうか・書体が分かるまでは
  // 同じ見た目で回る印を出す（止まっているのか待っているのか分かるように）
  useEffect(() => { void SplashScreen.hideAsync(); }, []);
  // 前に保存・共有へ渡した一時ファイル（共有シートはもう閉じている）
  useEffect(() => { clearShareCache(); }, []);
  if (!ready) return <BootScreen />;
  const nav = {
    ...DarkTheme,
    dark: theme.isDark,
    colors: { ...DarkTheme.colors, background: theme.bg, card: theme.bg, text: theme.ink, primary: accent.primary, border: theme.line },
  };
  const signedIn = status === 'signedIn';
  return (
    <ThemeProvider value={nav}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(main)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
