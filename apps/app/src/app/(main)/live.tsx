import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { LiveMessage } from '../../features/live/LiveMessage';

/**
 * ライブ視聴（元の live.jsx の LiveScreen）。番組表・予約詳細の「ライブ視聴」から局（sid / onid）を受けて開く。
 * 映像は PlayerHost がこの画面の上に出す（画面を離れても視聴を続けるため）。ここは局の指定が無い時の案内だけ
 */
export default function LiveRoute() {
  const { sid, onid } = useLocalSearchParams<{ sid?: string; onid?: string }>();
  if (sid && onid) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  return <LiveMessage loading={false} error={null} />;
}
