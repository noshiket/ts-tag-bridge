import { danmakuTop, layoutDanmaku, visibleDanmaku, type Comment, type DanmakuItem, type DanmakuLayout } from '@tstag/core';
import { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

/** 実況を映像の上に流す（元の Web 版の Danmaku と同じ速さ・大きさ・段の決め方） */
export function DanmakuOverlay({ comments, time, playing, rate, opacity, scale, maxOnScreen }: {
  /** iOS の部品が位置を見る再生器（この JS の弾幕では使わない） */
  player?: () => unknown;
  /** 流すもの（ミュートしたものは除いてある） */
  comments: Comment[];
  time: number;
  playing: boolean;
  rate: number;
  /** 設定（透過・文字の倍率・同時に出す数の上限） */
  opacity: number;
  scale: number;
  maxOnScreen: number;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const layout = useMemo(() => (size.w ? layoutDanmaku(comments, size.w, size.h, { scale, maxOnScreen }) : null),
    [comments, size.w, size.h, scale, maxOnScreen]);

  // 再生位置は 1 秒に 4 回しか届かないので、その間は経過時間で進めて滑らかに流す
  const clock = useSharedValue(time);
  const running = useSharedValue(playing ? rate : 0);
  useEffect(() => { running.value = playing ? rate : 0; }, [playing, rate, running]);
  useEffect(() => {
    const d = time - clock.value;
    // 大きくずれた（シークした）時だけ合わせ直す。小さいずれは少しずつ寄せる（逆戻りでがたつかない）
    clock.value = Math.abs(d) > 0.5 ? time : clock.value + d * 0.2;
  }, [time, clock]);
  useFrameCallback((f) => {
    'worklet';
    clock.value += ((f.timeSincePreviousFrame ?? 0) / 1000) * running.value;
  });

  // 描くのは今出ているもの（少し先に出るものも先に置いておく）。入れ替えは 1 秒に 4 回まで
  const shown = useMemo(() => {
    if (!layout) return [];
    const now = visibleDanmaku(layout, time);
    const soon = layout.items.filter((it) => it.time > time && it.time <= time + 0.5);
    return [...now, ...soon];
  }, [layout, time]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer, { opacity }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {layout && shown.map((it) => <Flying key={it.key} item={it} layout={layout} clock={clock} />)}
    </View>
  );
}

const Flying = memo(function Flying({ item, layout, clock }: { item: DanmakuItem; layout: DanmakuLayout; clock: SharedValue<number> }) {
  const { width, lineHeight, fontSize } = layout;
  const top = danmakuTop(layout, item);
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const x = item.mode === 'rtl'
      ? width - ((width + item.width) * (t - item.time)) / item.duration
      : (width - item.width) / 2;
    const on = t >= item.time && t < item.time + item.duration;
    return { transform: [{ translateX: x }], opacity: on ? 1 : 0 };
  });
  return (
    <Animated.Text numberOfLines={1} style={[styles.text, style, { top, fontSize, lineHeight, color: item.color }]}>
      {item.text}
    </Animated.Text>
  );
});

const styles = StyleSheet.create({
  layer: { overflow: 'hidden' },
  // 元は太さ 600・黒い縁取り。React Native は縁取りが無いので影で代わりにする
  text: {
    position: 'absolute', left: 0, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 3,
  },
});
