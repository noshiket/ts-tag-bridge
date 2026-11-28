import { Slot } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TabBar } from '../../../features/shell/TabBar';

/** 下のタブで切り替える画面（元の Web 版と同じく、切り替えると画面ごと入れ替わる） */
export default function TabsLayout() {
  return (
    <View style={styles.wrap}>
      <View style={styles.wrap}><Slot /></View>
      <TabBar />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1 } });
