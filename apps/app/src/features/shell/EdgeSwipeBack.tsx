import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

/**
 * 左の端から右へなぞって前の画面へ戻る（再生画面用）。プレイヤーは画面の外（PlayerHost）に置いていて、
 * 再生画面そのものは空のため、画面の出入りの動き（と、なぞって戻る仕組み）を切っている。代わりにここで受ける。
 * 端の細い帯だけで受けるので、映像の上のほかの操作（叩く・シーク）とはぶつからない
 */
export function EdgeSwipeBack({ onBack }: { onBack: () => void }) {
  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetX: 12,
    failOffsetY: [-24, 24],
    onDeactivate: (e) => {
      if (e.translationX > 70 || e.velocityX > 600) onBack();
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.edge} />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 24 },
});
