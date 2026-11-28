import type { Video } from '@tstag/core';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';

/**
 * 同じ話（話数・話数名が同じ）の動画を左右にめくって切り替える（元の Web 版の DupVideoStack）。
 * 初めはコメントの多いもの。重なりが分かるよう後ろにずらしたカードを敷く
 */
export function DupVideoStack({ videos, render }: { videos: Video[]; render: (v: Video) => ReactNode }) {
  const { theme, accent } = useTheme();
  const [width, setWidth] = useState(0);
  const [idx, setIdx] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const i = Math.max(0, Math.min(videos.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== idx) setIdx(i);
  };
  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 6)}>
      <View style={[styles.behind, { borderColor: theme.line, backgroundColor: theme.surface2 }]} />
      {/* 幅が分かるまでは先頭の1枚だけ。幅0で全部並べると、Safari は幅が決まった時に吸着先を選び直して
          最後のカードへ飛び、開いた時から「3/3」になっていた */}
      {width > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32}
          contentOffset={{ x: 0, y: 0 }}>
          {videos.map((v) => <View key={v.id} style={{ width }}>{render(v)}</View>)}
        </ScrollView>
      ) : <View>{render(videos[0]!)}</View>}
      <View pointerEvents="none" style={[styles.count, { backgroundColor: accent.primary }]}>
        <T mono w={800} size={9} color="#fff">{`↔ ${idx + 1}/${videos.length}`}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', paddingRight: 6, paddingBottom: 6 },
  behind: { position: 'absolute', top: 6, left: 6, right: 0, bottom: 0, borderRadius: 14, borderWidth: 1.5 },
  count: { position: 'absolute', top: -6, right: -2, zIndex: 2, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8 },
});
