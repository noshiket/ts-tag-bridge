import { Image } from 'expo-image';
import { StyleSheet, View, type DimensionValue } from 'react-native';

import type { MusicLibrary } from '../useMusicLibrary';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { shadow } from '../../../../ui/theme/edge';

/**
 * レコード棚のジャケット: 正方形のジャケットの右から、レコードが少しのぞく。
 * 箱の幅（width。既定は入れ物いっぱい）のうち 80% がジャケット、残りにレコードがはみ出す。
 * レコードの盤は中身なので黒、中央のラベルはアクセントの色。暗いテーマでは地に沈まないよう少し明るい黒に縁を付ける
 */
export function Sleeve({ m, uri, width = '100%', placeholder = '🎵' }: { m: MusicLibrary; uri: string | null; width?: DimensionValue; placeholder?: string }) {
  const { theme, accent } = useTheme();
  return (
    <View style={[styles.box, { width }]}>
      <View style={[styles.disc, theme.isDark && styles.discDark]}>
        <View style={[styles.ring, styles.r1]} />
        <View style={[styles.ring, styles.r2]} />
        <View style={[styles.label, { backgroundColor: accent.primary }]} />
        <View style={[styles.hole, { backgroundColor: theme.bg }]} />
      </View>
      <View style={[styles.sleeve, { backgroundColor: theme.surface2, borderColor: theme.cardFrame, boxShadow: shadow(theme, 3) }]}>
        {uri
          ? <Image source={{ uri, headers: m.api.client.authHeaders() }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          : <T size={24}>{placeholder}</T>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 高さはジャケット（幅の 80%）と同じ
  box: { aspectRatio: 1 / 0.8 },
  sleeve: { width: '80%', aspectRatio: 1, borderRadius: 3, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  disc: { position: 'absolute', left: '22%', top: '3.75%', width: '74%', aspectRatio: 1, borderRadius: 999, backgroundColor: '#141414', alignItems: 'center', justifyContent: 'center' },
  discDark: { backgroundColor: '#242327', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  ring: { position: 'absolute', aspectRatio: 1, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  r1: { width: '82%' },
  r2: { width: '62%' },
  label: { position: 'absolute', width: '34%', aspectRatio: 1, borderRadius: 999 },
  hole: { position: 'absolute', width: '6%', aspectRatio: 1, borderRadius: 999 },
});
