import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Tv } from './Icons';
import { oklch } from '../theme/oklch';
import { useTheme } from '../theme/Tweaks';
import { shadow } from '../theme/edge';

/**
 * 予約・録画・ライブラリのカードのサムネ（元の EncodeThumb）。画像があればそれ、無い・読めない時は
 * 色相から作るフィルムの絵（ReelThumb）。枠線は画像そのものに付け、下に色の地を敷かない
 * （敷くと角の丸めで縁に細くはみ出す）。children は画像に重ねる物（見た所までの線など）
 */
export function ReelThumb({ source, hue, size = 44, width, height, children }: {
  source?: { uri: string; headers?: Record<string, string> } | null;
  hue: number;
  size?: number;
  /** 横長にする時（無ければ size の正方形） */
  width?: number;
  height?: number;
  children?: ReactNode;
}) {
  const { theme } = useTheme();
  const [err, setErr] = useState(false);
  const w = width ?? size, h = height ?? size;
  const frame = { width: w, height: h, borderColor: theme.frame, boxShadow: shadow(theme, 2) };
  if (source && !err) {
    const img = <Image source={source} style={[styles.box, frame]} contentFit="cover" cachePolicy="memory-disk" onError={() => setErr(true)} />;
    if (!children) return img;
    return (
      <View style={[styles.wrap, { width: w, height: h }]}>
        {img}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.over]}>{children}</View>
      </View>
    );
  }
  const c1 = oklch(0.75, 0.18, hue);
  const c2 = oklch(0.48, 0.22, (hue + 40) % 360);
  const holes = (side: 'left' | 'right') => (
    <View style={[styles.strip, { [side]: 0, backgroundColor: theme.ink }]}>
      {[0, 1, 2, 3].map((i) => <View key={i} style={[styles.hole, { backgroundColor: c1 }]} />)}
    </View>
  );
  return (
    <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.box, frame, styles.reel]}>
      {holes('left')}
      {holes('right')}
      <Tv s={Math.min(w, h) * 0.38} c="rgba(255,255,255,0.9)" />
      {children && <View pointerEvents="none" style={StyleSheet.absoluteFill}>{children}</View>}
    </LinearGradient>
  );
}

/** 予約・録画の番号から決まる色相（元の _hueFromId） */
export const hueFromId = (n: number) => (n * 67 + 180) % 360;

const styles = StyleSheet.create({
  box: { borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', flexShrink: 0 },
  reel: { alignItems: 'center', justifyContent: 'center' },
  wrap: { flexShrink: 0 },
  // 重ねる物は枠線の内側・角の丸めに合わせて切る
  over: { borderRadius: 12, overflow: 'hidden', margin: 1.5 },
  strip: { position: 'absolute', top: 0, bottom: 0, width: 6, justifyContent: 'space-around', paddingVertical: 4, alignItems: 'center' },
  hole: { width: 3, height: 3, borderRadius: 1 },
});
