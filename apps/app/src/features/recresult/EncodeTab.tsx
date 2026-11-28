import { useEncodes } from '@tstag/core/react';
import { StyleSheet } from 'react-native';

import { T } from '../../ui/parts/T';
import { AndonView } from './andon/AndonView';
import { useT } from '../../ui/i18n/I18n';

/** 録画結果の「エンコード」タブ: アンドン表示（稼働・停止・異常のランプ、実行中、待ちの列、履歴） */
export function EncodeTab({ node }: { node: string | null }) {
  const encodes = useEncodes(node);
  const { t: tx } = useT();
  if (encodes.data) return <AndonView rows={encodes.data} node={node} />;
  return <T size={12} dim style={styles.empty}>{encodes.error ? encodes.error.message : tx('common.loading')}</T>;
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', padding: 40 },
});
