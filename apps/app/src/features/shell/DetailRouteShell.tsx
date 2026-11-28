import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabBar } from './TabBar';
import { T } from '../../ui/parts/T';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';

/**
 * 詳細の画面の枠（録画・予約・EPG予約・プログラム予約）: 中身が用意できたら children、
 * まだなら見出しと一言（読み込み中・見つからない・エラー）。下にタブバー
 */
export function DetailRouteShell({ ready, title, onBack, afterTitle, message, children }: {
  ready: boolean; title: string; onBack: () => void; afterTitle?: ReactNode; message: string; children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      {ready ? children : (
        <>
          <TopBar title={title} onBack={onBack} afterTitle={afterTitle} />
          <T size={13} dim style={styles.empty}>{message}</T>
        </>
      )}
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  empty: { textAlign: 'center', marginTop: 40, padding: 40 },
});
