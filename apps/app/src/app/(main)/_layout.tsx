import { router, Stack, usePathname, useGlobalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';

import { DesktopSidebar } from '../../features/shell/DesktopSidebar';
import { PlayerHost } from '../../features/shell/PlayerHost';
import { usePrefetchOtherServer } from '../../features/shell/prefetchServer';
import { useIsPC } from '../../features/shell/TabBar';
import { useAppLog } from '../../lib/lifecycle/appLog';
import { usePlayerFullscreen } from '../../lib/playback/fullscreenState';
import { useWatchPendingSync } from '../../lib/device/watchPending';

import { useTheme } from '../../ui/theme/Tweaks';

/** 見出しは各画面の中で TopBar を描く（元の Web 版と同じ見た目にするため）ので、標準の見出しは出さない */
export default function MainLayout() {
  const { theme } = useTheme();
  useAppLog();
  // 通信の無い所で見た位置を、通信が戻ったらサーバーへ送る
  useWatchPendingSync();
  // サーバー切り替えの次のサーバーの一覧を先に取っておき、切り替えた時にすぐ出す
  usePrefetchOtherServer();
  // 開発ビルドの確認用: Metro を EXPO_PUBLIC_DEV_START_PATH=/watch/123 付きで動かすと、その画面から始める
  // （シミュレータは画面を押せないため）。配布するビルドでは __DEV__ が false なので通らない
  useEffect(() => {
    const start = process.env.EXPO_PUBLIC_DEV_START_PATH;
    if (__DEV__ && start) router.push(start as never);
  }, []);
  // プレイヤーは画面の外（Stack の上）に置き、画面を離れても鳴らし続ける（PlayerHost）。
  // 再生画面そのものは空なので、出入りの動きは付けない
  // PC の幅は左に縦の帯（元の DesktopSidebar）。再生画面（watch/live）が前面の間と全画面の間は隠す（元は theater の間隠す）
  const isPC = useIsPC();
  const fullscreen = usePlayerFullscreen();
  // Web で watch/live が前面の間は没入（旧 Web 版の theater）。PlayerHost がセッションを作る条件に合わせ、
  // live は sid/onid が揃うまではナビを隠さない
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const playerFront = Platform.OS === 'web'
    && (/^\/watch\/[^/]+$/.test(pathname) || (pathname === '/live' && params.sid && params.onid));
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.bg }}>
      {isPC && !fullscreen && !playerFront && <DesktopSidebar />}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="watch/[id]" options={{ animation: 'none', gestureEnabled: false }} />
          <Stack.Screen name="live" options={{ animation: 'none', gestureEnabled: false }} />
        </Stack>
        <PlayerHost />
      </View>
    </View>
  );
}
