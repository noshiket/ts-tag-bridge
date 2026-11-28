import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EncodingScreen } from '../../../features/encoding/EncodingScreen';
import { TabBar } from '../../../features/shell/TabBar';
import { useTheme } from '../../../ui/theme/Tweaks';

/** エンコード進捗（元の queue.jsx の EncodingScreen）。番号はエンコード（encodings）の番号 */
export default function EncodingRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <EncodingScreen encId={Number(id)} />
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
