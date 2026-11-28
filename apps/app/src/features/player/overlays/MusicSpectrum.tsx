import type { AudioViz } from '@tstag/core';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { isAppActive } from '../../../lib/lifecycle/appActive';

/**
 * 音楽のスペクトラム（元の stream.jsx と同じ）。ジャケットの下端に重ねる。
 * 再生位置のコマの値へ、上がる時は速く・下がる時はゆっくり寄せる（棒がガタつかない）
 */
export function MusicSpectrum({ viz, now, playing }: { viz: AudioViz; now: () => number; playing: boolean }) {
  const level = useRef(new Float32Array(viz.nb));
  const [levels, setLevels] = useState<number[]>(() => Array(viz.nb).fill(0));
  useEffect(() => {
    level.current = new Float32Array(viz.nb);
    let raf = 0;
    let dead = false;
    const step = () => {
      if (dead) return;
      const col = Math.min(viz.cols - 1, Math.max(0, Math.round(now() * viz.fps)));
      const base = col * viz.nb;
      const lv = level.current;
      let moving = false;
      for (let i = 0; i < viz.nb; i++) {
        const target = (viz.bands[base + i] ?? 0) / 255;
        const next = target > lv[i]! ? target : lv[i]! * 0.86 + target * 0.14;
        if (Math.abs(next - lv[i]!) > 0.002) moving = true;
        lv[i] = next;
      }
      // 背面（画面を消して聴いている時など）は描き直さない
      if (moving && isAppActive()) setLevels(Array.from(lv));
      // 止めている間も、棒が下がりきるまでは回す
      if (playing || moving) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [viz, now, playing]);
  return (
    <View pointerEvents="none" style={styles.wrap}>
      {levels.map((l, i) => (
        <View key={i} style={styles.col}>
          <View style={{ height: `${Math.max(1, l * 100)}%`, backgroundColor: `hsla(${200 + i * 4}, 90%, ${45 + l * 25}%, 0.85)` }} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '22%', flexDirection: 'row', opacity: 0.9 },
  col: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 1 },
});
