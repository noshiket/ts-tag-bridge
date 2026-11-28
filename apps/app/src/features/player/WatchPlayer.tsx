import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useLocalPlayback } from './useLocalPlayback';
import { WatchPlayerBody } from './watch/WatchPlayerBody';
import type { WatchParams } from '../../lib/playback/miniPlayer';
import { T } from '../../ui/parts/T';
import { useT } from '../../ui/i18n/I18n';

/**
 * 録画・動画の再生（元の stream.jsx の StreamScreen）。PlayerHost が画面の外に置き、再生画面を離れても
 * 隠して鳴らし続ける（active でない間は下のミニプレイヤーから操作する。元と同じ）。
 * from=start: 頭から。tot=<放送時刻>: その位置から（キャプチャの「ここから」）。
 * kind=rec: 録画（EDCB の TS）を再生する。番号は録画の db_rec_id（元の streamTarget.recId）。
 * node: どのサーバーのものか（開いた時に決める）。
 * go: 別の話数などへ移る（見ている間は画面ごと、隠れている間は画面を動かさずに）。
 * band: 下の帯のサムネの枠に映像だけを出している（PlayerHost が枠の大きさに置く）
 */
export function WatchPlayer(props: { params: WatchParams; active: boolean; band?: boolean; go: (p: WatchParams) => void }) {
  const { t: tx } = useT();
  const local = useLocalPlayback(props.params);
  if (local.status === 'loading') return <View style={styles.blank}><T mono size={12} color="#fff">{tx('player.watchPlayer.loadingOfflineStorage')}</T></View>;
  // 見つからない時も戻れるように（戻る手段が無く、操作できなくなった）
  if (local.status === 'missing') {
    return (
      <View style={styles.blank}>
        <T mono size={12} color="#fff">{tx('player.watchPlayer.offlineCopyNotFound')}</T>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.missingBack}>
          <T mono size={12} w={700} color="#fff">{tx('common.back2')}</T>
        </Pressable>
      </View>
    );
  }
  return <WatchPlayerBody {...props} local={local.bundle} />;
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  missingBack: { marginTop: 16, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
});
