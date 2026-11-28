import { StyleSheet, View } from 'react-native';

import { DETAIL_RED, DetailBig, detailStyles } from './detailButtons';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 連携先へ移動する確認（成功後このサーバーからは消える。前回の失敗も見せる） */
export function PushConfirm({ peer, lastError, onCancel, onRun }: { peer: string | null; lastError: string | null; onCancel: () => void; onRun: () => void }) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  return (
    <View>
      <T size={11} w={800} color={accent.tertiary} style={styles.mb4}>{tx('library.videoConfirmPanels.moveVideo', { v0: peer })}</T>
      <T mono size={9} dim style={styles.note}>{tx('library.videoConfirmPanels.transfersMp4TagJson')}</T>
      {lastError != null && <T mono size={9} color={oklch(0.5, 0.22, 25)} style={styles.mb8}>{tx('library.videoConfirmPanels.lastMoveFailed', { v0: lastError })}</T>}
      <View style={detailStyles.moves}>
        <DetailBig onPress={onCancel}>{tx('common.cancel')}</DetailBig>
        <DetailBig bg={accent.tertiary} onPress={onRun}>{tx('library.videoConfirmPanels.move')}</DetailBig>
      </View>
    </View>
  );
}

/** ライブラリから完全に消す確認（元に戻せない。キャプチャは残る） */
export function DeleteConfirm({ deleting, error, onCancel, onRun }: { deleting: boolean; error: string; onCancel: () => void; onRun: () => void }) {
  const { t: tx } = useT();
  return (
    <View>
      <T size={11} w={800} color={oklch(0.45, 0.22, 25)} style={styles.mb4}>{tx('library.videoConfirmPanels.permanentlyDeleteVideo')}</T>
      <T mono size={9} color={oklch(0.45, 0.18, 25)} style={styles.note}>{tx('library.videoConfirmPanels.deletesMp4TagJson')}</T>
      {!!error && <T mono size={9} color={oklch(0.5, 0.22, 25)} style={styles.mb8}>{error}</T>}
      <View style={detailStyles.moves}>
        <DetailBig disabled={deleting} onPress={onCancel}>{tx('common.cancel')}</DetailBig>
        <DetailBig bg={DETAIL_RED} disabled={deleting} onPress={onRun}>{deleting ? tx('common.deleting2') : tx('common.delete2')}</DetailBig>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mb4: { marginBottom: 4 },
  mb8: { marginBottom: 8 },
  note: { lineHeight: 14, marginBottom: 10 },
});
