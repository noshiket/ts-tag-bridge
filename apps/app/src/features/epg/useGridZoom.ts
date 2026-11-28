import { anchoredScroll, clampScale, clampVZoom, minScale, pinchAnchor, type PinchAnchor } from '@tstag/core';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { usePinchGesture } from 'react-native-gesture-handler';
import { Animated, Platform, type ScrollViewInstance } from 'react-native';

import { HEADER_H, RULER_W } from './EpgGrid';

/**
 * 番組表の拡大縮小。番組の所をつまむと縦横とも、時刻の列をつまむと時間の軸だけ（元と同じ）。
 * つまんでいる間は描き直さず、中身を見た目だけ伸び縮みさせる（live / liveV と、伸び縮みの中心 ox / oy）。
 * 番組を全部描き直すと指の動きに追いつかず、アプリではカクついた。指を離した時に大きさを決めて1回だけ描き直し、
 * つまんだ所が指の真ん中に残るようにスクロールを合わせてから、見た目の伸び縮みを戻す
 */
export function useGridZoom({ zoom, pxPerHour, colWidth, columnCount, scroll, width, hRef, vRef }: {
  zoom: { scale: number; vZoom: number; colBase: number; onChange: (z: { scale?: number; vZoom?: number }) => void };
  pxPerHour: number; colWidth: number; columnCount: number;
  scroll: RefObject<{ x: number; y: number }>; width: RefObject<number>;
  hRef: RefObject<ScrollViewInstance | null>; vRef: RefObject<ScrollViewInstance | null>;
}) {
  const live = useRef(new Animated.Value(1)).current;
  const liveV = useRef(new Animated.Value(1)).current;
  const ox = useRef(new Animated.Value(0)).current;
  const oy = useRef(new Animated.Value(0)).current;
  const pinch = useRef<{ vertical: boolean; start: number; next: number; anchor: PinchAnchor } | null>(null);
  // 指を離して決めた大きさで描き直した後に、スクロールを合わせて見た目の伸び縮みを戻す
  const settling = useRef<{ vertical: boolean; anchor: PinchAnchor } | null>(null);
  const begin = (vertical: boolean, focalX: number, focalY: number) => {
    const start = vertical ? zoom.vZoom : zoom.scale;
    // 番組の所の左上からの位置（見出しの高さを引く。時刻の列では横は動かさない）
    const anchor = pinchAnchor(vertical ? 0 : focalX, focalY - HEADER_H, scroll.current.x, scroll.current.y, pxPerHour, colWidth);
    pinch.current = { vertical, start, next: start, anchor };
    ox.setValue(anchor.cols * colWidth);
    oy.setValue(anchor.hours * pxPerHour);
  };
  const finish = () => {
    const p = pinch.current;
    pinch.current = null;
    if (!p) return;
    if (p.next === p.start) { live.setValue(1); liveV.setValue(1); return; }
    settling.current = { vertical: p.vertical, anchor: p.anchor };
    zoom.onChange(p.vertical ? { vZoom: p.next } : { scale: p.next });
  };
  const both = usePinchGesture({
    runOnJS: true,
    onActivate: (e) => begin(false, e.focalX, e.focalY),
    onUpdate: (e) => {
      const p = pinch.current;
      if (!p || p.vertical) return;
      p.next = clampScale(p.start * e.scale, minScale(width.current + RULER_W, RULER_W, columnCount, zoom.colBase));
      live.setValue(p.next / p.start);
    },
    onFinalize: finish,
  });
  const vertical = usePinchGesture({
    runOnJS: true,
    onActivate: (e) => begin(true, 0, e.focalY),
    onUpdate: (e) => {
      const p = pinch.current;
      if (!p?.vertical) return;
      p.next = clampVZoom(p.start * e.scale);
      liveV.setValue(p.next / p.start);
    },
    onFinalize: finish,
  });
  useLayoutEffect(() => {
    const p = settling.current;
    if (!p) return;
    settling.current = null;
    const t = anchoredScroll(p.anchor, pxPerHour, colWidth);
    if (!p.vertical) hRef.current?.scrollTo({ x: t.x, animated: false });
    vRef.current?.scrollTo({ y: t.y, animated: false });
    live.setValue(1);
    liveV.setValue(1);
  }, [pxPerHour, colWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  // 見た目の伸び縮み（中心は ox / oy）。番組は縦横、見出しは横、時刻は縦だけ
  const sy = Animated.multiply(live, liveV);
  const around = (o: Animated.Value, scale: Animated.AnimatedInterpolation<number> | Animated.Value, axis: 'X' | 'Y') =>
    axis === 'X'
      ? [{ translateX: o }, { scaleX: scale }, { translateX: Animated.multiply(o, -1) }]
      : [{ translateY: o }, { scaleY: scale }, { translateY: Animated.multiply(o, -1) }];
  // 伸び縮みの基準は左上（既定は真ん中なので、ずらした中心がその分ずれる）
  const origin = 'left top' as const;
  const lanesStyle = { transformOrigin: origin, transform: [...around(ox, live, 'X'), ...around(oy, sy, 'Y')] };
  const headStyle = { transformOrigin: origin, transform: around(ox, live, 'X') };
  const rulerStyle = { transformOrigin: origin, transform: around(oy, sy, 'Y') };
  return { both, vertical, lanesStyle, headStyle, rulerStyle };
}

/**
 * iOS Safari は指のつまみとは別に gesture イベントでページごと拡大縮小し、縮めきるとタブ一覧を開く
 * （viewport の user-scalable=no は効かない）。番組表の上ではそれを止めて、番組表のズームだけにする（元と同じ）。
 * 返す ref を番組表の枠に付ける
 */
export function useBlockPageZoom() {
  const frameRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = frameRef.current;
    if (!el?.addEventListener) return;
    const stop = (e: Event) => e.preventDefault();
    const names = ['gesturestart', 'gesturechange', 'gestureend'];
    names.forEach((n) => el.addEventListener(n, stop, { passive: false }));
    return () => names.forEach((n) => el.removeEventListener(n, stop));
  }, []);
  return frameRef;
}
