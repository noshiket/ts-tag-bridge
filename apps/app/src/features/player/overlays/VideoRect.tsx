import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** 枠（cw×ch）の中に収まる、映像の縦横比（aspect = 幅 ÷ 高さ。既定 16:9）の大きさ */
export const fitVideoRect = (cw: number, ch: number, aspect = 16 / 9) =>
  (cw / ch > aspect ? { width: ch * aspect, height: ch } : { width: cw, height: cw / aspect });

/**
 * 映像が実際に映る枠（aspect は映像の縦横比。縦長・4:3 の動画もあるので再生中の映像の大きさから渡す）。
 * 全画面などで枠と画面の縦横比が違うと上下・左右に黒帯ができるので、弾幕を黒帯に出さないよう、この枠の中に重ねる（元と同じ）
 */
export function VideoRect({ children, aspect = 16 / 9 }: { children: ReactNode; aspect?: number }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}
      onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {box && <View style={fitVideoRect(box.width, box.height, aspect)}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
