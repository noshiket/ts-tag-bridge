import { LOGO_DEFAULT_RECT, logoMoveCorner } from '@tstag/core';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LogoBtn, LogoNote, logoStyles as ls } from './logoParts';
import { logoRectStore } from '../logoRectStore';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/** パッドの端から端までなぞって映像の 25% 動く（指より小さく動くので細かく合わせられる） */
const PAD_GAIN = 0.25;

/** スマホ: 角を1つずつ（左上/右下）なぞって動かすパッド。解析中は動かせない */
export function LogoCornerPad({ running }: { running: boolean }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [corner, setCorner] = useState<'tl' | 'br'>('tl');
  const [pad, setPad] = useState({ width: 1, height: 1 });
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <View style={[ls.mt8, { opacity: running ? 0.5 : 1 }]}>
      <View style={[ls.row, styles.mb6]}>
        {([['tl', tx('player.logoCornerPad.topLeft')], ['br', tx('player.logoCornerPad.bottomRight')]] as const).map(([k, l]) => <LogoBtn key={k} on={corner === k} disabled={running} onPress={() => setCorner(k)}>{l}</LogoBtn>)}
        <View style={styles.grow} />
        <LogoNote>{tx('player.logoCornerPad.dragFineTune')}</LogoNote>
      </View>
      <View onLayout={(e) => setPad(e.nativeEvent.layout)}
        style={[styles.padArea, { borderColor: theme.line, backgroundColor: theme.surface2 }]}
        onStartShouldSetResponder={() => !logoRectStore.isLocked()}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          last.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          if (!logoRectStore.get()) logoRectStore.set({ ...LOGO_DEFAULT_RECT });
        }}
        onResponderMove={(e) => {
          const d = last.current;
          if (!d) return;
          const dx = ((e.nativeEvent.pageX - d.x) / pad.width) * PAD_GAIN;
          const dy = ((e.nativeEvent.pageY - d.y) / pad.height) * PAD_GAIN;
          last.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          logoRectStore.set(logoMoveCorner(logoRectStore.get() ?? { ...LOGO_DEFAULT_RECT }, corner, dx, dy));
        }}
        onResponderRelease={() => { last.current = null; }}>
        <LogoNote style={styles.center}>{running ? tx('player.logoCornerPad.cantChangeWhileAnalyzing') : tx('player.logoCornerPad.moveCorner', { v0: corner === 'tl' ? tx('player.logoCornerPad.topLeft') : tx('player.logoCornerPad.bottomRight') })}</LogoNote>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mb6: { marginBottom: 6 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  padArea: { height: 110, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', userSelect: 'none' },
});
