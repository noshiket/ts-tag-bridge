import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/I18n';

// 起動画面（app.json の expo-splash-screen）と同じ色・同じ絵
const BG = '#15121c';
const ICON = require('../../../assets/icon.png');

/**
 * 起動中の画面: 止まっていないと分かるように、起動画面と同じ絵の下で回る印を出す。
 * 3 秒を過ぎたら「起動中」と添える。書体の読み込みを待たないよう、端末の書体で出す
 */
export function BootScreen() {
  const { t: tx } = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={styles.root}>
      <Image source={ICON} style={styles.icon} />
      <ActivityIndicator color="rgba(255,255,255,0.7)" style={styles.spin} />
      <Text style={[styles.note, !slow && styles.hidden]}>{tx('common.booting')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 96, height: 96 },
  spin: { position: 'absolute', top: '50%', marginTop: 72 },
  note: { position: 'absolute', top: '50%', marginTop: 104, color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  hidden: { opacity: 0 },
});
