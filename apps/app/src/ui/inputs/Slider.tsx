import { useRef } from 'react';
import { StyleSheet, View, type DimensionValue, type GestureResponderEvent } from 'react-native';

import { trackX } from '../gestures/trackX';

const GREEN = '#10b981';

/**
 * つまみ（元の Web 版の range の代わり。緑）。押す・なぞるで min〜max を step 刻みで返し、離した時に onDone。
 * 幅を決めない時は並びに合わせて伸びる
 */
export function Slider({ value, min = 0, max = 1, step, width, label, onChange, onDone }: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  width?: DimensionValue;
  label: string;
  onChange: (v: number) => void;
  onDone?: (v: number) => void;
}) {
  const w = useRef(0);
  const at = (e: GestureResponderEvent) => {
    if (w.current <= 0) return value;
    const raw = min + Math.max(0, Math.min(1, trackX(e, w.current) / w.current)) * (max - min);
    // 刻みに合わせ、小数の誤差（0.30000000000000004 など）を落とす
    return step ? Math.round(Math.round((raw - min) / step) * step * 1e6) / 1e6 + min : raw;
  };
  const pct = `${((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100}%` as const;
  return (
    <View
      style={[styles.bar, width != null ? { width } : styles.grow]}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      onLayout={(e) => { w.current = e.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => onChange(at(e))}
      onResponderMove={(e) => onChange(at(e))}
      onResponderRelease={(e) => onDone?.(at(e))}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: pct }]} />
      </View>
      <View pointerEvents="none" style={[styles.knob, { left: pct }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 24, justifyContent: 'center' },
  grow: { flex: 1 },
  track: { height: 4, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.35)', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: GREEN },
  knob: { position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: GREEN },
});
