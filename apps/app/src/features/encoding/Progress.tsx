import type { EncodeRow } from '@tstag/core';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Check } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme, type ProgressStyle } from '../../ui/theme/Tweaks';
import { useAppActive } from '../../lib/lifecycle/appActive';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

// エンコードの進み具合の3つの見せ方（元の queue.jsx の BarProgress / RingProgress / StepsProgress）。
// 速度・残り時間・大きさはサーバーが返さないので、元と同じく空のまま出す

export function EncodeProgress({ e, style }: { e: EncodeRow; style: ProgressStyle }) {
  if (style === 'bar') return <BarProgress e={e} />;
  if (style === 'steps') return <StepsProgress e={e} />;
  return <RingProgress e={e} />;
}

const pct = (e: EncodeRow) => Math.round(e.progress * 100);

function useBox() {
  const { theme } = useTheme();
  return [styles.box, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 4) }];
}

function BarProgress({ e }: { e: EncodeRow }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const bars = 36;
  const [tick, setTick] = useState(0);
  // 前にいる間だけ動かす（背面で 0.12 秒ごとに描き直さない）
  const appActive = useAppActive();
  useEffect(() => { if (!appActive) return; const t = setInterval(() => setTick((x) => x + 1), 120); return () => clearInterval(t); }, [appActive]);
  const cols = [accent.primary, accent.secondary, accent.tertiary, accent.quaternary];
  return (
    <View style={useBox()}>
      <View style={styles.head}>
        <T size={58} w={800} style={styles.big}>{String(pct(e))}<T size={24} w={800} color={accent.primary}>%</T></T>
        <View style={[styles.pill, { backgroundColor: accent.primary, borderColor: theme.frame }]}><T mono size={9} w={700} color="#fff">ENCODING</T></View>
      </View>
      <T mono size={10} dim style={styles.mb14}>{tx('encoding.progress.speed')}</T>
      <View style={[styles.wave, { borderColor: theme.frame }]}>
        {Array.from({ length: bars }, (_, i) => {
          const done = i < e.progress * bars;
          const amp = 0.3 + (Math.sin(i * 0.5 + tick * 0.3) * 0.35 + Math.sin(i * 0.2 + tick * 0.1) * 0.3 + 0.5) * 0.7;
          return <View key={i} style={[styles.waveBar, { height: Math.max(3, done ? amp * 60 : amp * 14), backgroundColor: done ? cols[Math.floor(i / 9) % 4] : theme.surface2 }]} />;
        })}
      </View>
      <View style={styles.foot}>
        {['00:00', 'ENCODING...', '30:00'].map((s) => <T key={s} mono size={9} dim>{s}</T>)}
      </View>
    </View>
  );
}

function RingProgress({ e }: { e: EncodeRow }) {
  const { theme, accent } = useTheme();
  const size = 180, stroke = 22;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View style={[useBox(), styles.center]}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={styles.rot}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.surface2} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={accent.primary} strokeWidth={stroke} fill="none"
            strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - e.progress)} strokeLinecap="round" />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <T size={42} w={800} style={styles.lh1}>{String(pct(e))}<T size={18} w={800} color={accent.primary}>%</T></T>
          <T mono size={10} w={700} dim style={styles.mt2}>ENCODING</T>
          <T mono size={9} dim>ETA </T>
        </View>
      </View>
      <View style={styles.spd}>
        <T mono size={10} dim>SPD </T><T mono size={10} dim>·</T><T mono size={10} dim> </T>
      </View>
    </View>
  );
}

function StepsProgress({ e }: { e: EncodeRow }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const stages = [
    { k: 'make_DB', l: tx('state.enc.make_DB'), c: accent.tertiary },
    { k: 'split_ts', l: tx('state.enc.split_ts'), c: accent.secondary },
    { k: 'encoding', l: tx('recresult.tab.encode'), c: accent.primary },
    { k: 'encoded_analyze', l: tx('state.enc.encoded_analyze'), c: accent.quaternary },
    { k: 'file_copy', l: tx('encoding.progress.fileCopy'), c: accent.tertiary },
    { k: 'encode_end', l: tx('state.rec.encode_finish'), c: accent.quaternary },
  ];
  const found = stages.findIndex((s) => s.k === e.state);
  const idx = found >= 0 ? found : 0;
  return (
    <View style={[useBox(), styles.stepsBox]}>
      <View style={[styles.head, styles.mb12]}>
        <T size={38} w={800} style={styles.lh1}>{String(pct(e))}<T size={38} w={800} color={accent.primary}>%</T></T>
        <T mono size={10} dim>ETA </T>
      </View>
      {stages.map((s, i) => {
        const st = i < idx || (i === idx && s.k === 'encode_end') ? 'done' : i === idx ? 'active' : 'wait';
        return (
          <View key={s.k} style={[styles.step, i < stages.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
            <View style={[styles.stepNo, { backgroundColor: st === 'wait' ? theme.surface2 : s.c, borderColor: theme.frame }]}>
              {st === 'done' ? <Check s={12} c="#fff" w={3} /> : <T mono size={10} w={700} color="#fff">{String(i + 1).padStart(2, '0')}</T>}
            </View>
            <View style={styles.grow}>
              <T size={12} w={700} color={st === 'wait' ? theme.mute : theme.ink}>{s.l}</T>
              <T mono size={9} dim>{s.k}</T>
            </View>
            {st === 'active' && <Dots c={s.c} />}
            {st === 'done' && <T mono size={9} w={700} color={s.c}>DONE</T>}
          </View>
        );
      })}
    </View>
  );
}

/** 実行中の工程の3つの点（元の pulse） */
function Dots({ c }: { c: string }) {
  const v = useRef(new Animated.Value(0)).current;
  const appActive = useAppActive();
  useEffect(() => {
    if (!appActive) return;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1000, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [v, appActive]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((d) => {
        const s = d * 0.15;
        const opacity = v.interpolate({ inputRange: [0, s, s + 0.4, 1], outputRange: [0.3, 0.3, 1, 0.3], extrapolate: 'clamp' });
        return <Animated.View key={d} style={[styles.dot, { backgroundColor: c, opacity }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: 20, padding: 18 },
  stepsBox: { padding: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 },
  big: { lineHeight: 56, letterSpacing: -2 },
  lh1: { lineHeight: 44 },
  pill: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1.5 },
  mb14: { marginBottom: 14 },
  mb12: { marginBottom: 12 },
  mt2: { marginTop: 2 },
  wave: { flexDirection: 'row', gap: 2, alignItems: 'flex-end', height: 60, paddingVertical: 6, borderTopWidth: 1.5, borderBottomWidth: 1.5 },
  waveBar: { flex: 1, borderRadius: 1.5 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rot: { transform: [{ rotate: '-90deg' }] },
  spd: { marginTop: 12, flexDirection: 'row', gap: 10 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8 },
  stepNo: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
