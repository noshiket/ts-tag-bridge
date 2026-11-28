import { containRect, logoCornerAnchor, logoNormalize } from '@tstag/core';
import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { logoRectStore, useLogoLocked, useLogoRect } from '../tabs/logoRectStore';
import { useT } from '../../../ui/i18n/I18n';

/** 四隅のつまみの当たりの幅（px） */
const HANDLE = 22;
/** 放送は 16:9 で出る（1440×1080 の TS も横に伸ばして出す） */
const ASPECT = 16 / 9;

/**
 * 映像の上でロゴを囲む層（元の LogoRectOverlay）。黒帯を除いた映像の中だけで受ける。
 * 四隅を掴めばその角を動かせる。操作の表示（上下のバー・真ん中のボタン）はこの上に来る
 */
export function LogoRectOverlay() {
  const { t: tx } = useT();
  const { accent } = useTheme();
  const rect = useLogoRect();
  const locked = useLogoLocked();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const v = containRect(box.width, box.height, ASPECT);
  const from = useRef<{ x: number; y: number } | null>(null);

  const rel = (e: GestureResponderEvent) => ({
    x: Math.max(0, Math.min(1, e.nativeEvent.locationX / (v.width || 1))),
    y: Math.max(0, Math.min(1, e.nativeEvent.locationY / (v.height || 1))),
  });
  const has = !!rect && rect.w > 0.001 && rect.h > 0.001;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <View style={[styles.area, { left: v.left, top: v.top, width: v.width, height: v.height }]}
        onStartShouldSetResponder={() => !locked}
        onMoveShouldSetResponder={() => !locked}
        // 再生・一時停止の切り替え（映像のタップ）へ渡さない
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          const p = rel(e);
          const a = logoCornerAnchor(logoRectStore.get(), p, { x: HANDLE / (v.width || 1), y: HANDLE / (v.height || 1) });
          from.current = a ?? p;
          if (!a) logoRectStore.set({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onResponderMove={(e) => { if (from.current) logoRectStore.set(logoNormalize(from.current, rel(e))); }}
        onResponderRelease={() => { from.current = null; }}>
        {(locked || !has) && (
          <View pointerEvents="none" style={styles.hint}>
            <T size={12} color="#fff" style={styles.shadow}>{locked ? tx('player.logoRectOverlay.rangeCantChangedWhile') : tx('player.logoRectOverlay.dragEncloseLogo')}</T>
          </View>
        )}
        {/* 範囲の外を暗くする（上・下・左・右の4枚） */}
        {has && rect && [
          { left: 0, right: 0, top: 0, height: `${rect.y * 100}%` },
          { left: 0, right: 0, top: `${(rect.y + rect.h) * 100}%`, bottom: 0 },
          { left: 0, width: `${rect.x * 100}%`, top: `${rect.y * 100}%`, height: `${rect.h * 100}%` },
          { left: `${(rect.x + rect.w) * 100}%`, right: 0, top: `${rect.y * 100}%`, height: `${rect.h * 100}%` },
        ].map((d, i) => <View key={`m${i}`} pointerEvents="none" style={[styles.mask, d as object]} />)}
        {has && rect && (
          <View pointerEvents="none" style={[styles.rect, {
            left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
            borderColor: accent.primary,
          }]}>
            {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy], i) => (
              <View key={i} style={[styles.handle, { left: `${cx! * 100}%`, top: `${cy! * 100}%`, backgroundColor: accent.primary }]} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', overflow: 'hidden', userSelect: 'none' },
  hint: { position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' },
  shadow: { textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  rect: { position: 'absolute', borderWidth: 2 },
  mask: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.45)' },
  handle: { position: 'absolute', width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 3, borderWidth: 2, borderColor: '#fff' },
});
