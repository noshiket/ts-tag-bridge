import type { AddVideoForm } from '@tstag/core';
import { StyleSheet } from 'react-native';

import { ManualVideoFields } from './ManualVideoFields';
import { TagVideoFields } from './TagVideoFields';
import { useAddVideo } from './useAddVideo';
import { ResultMessage } from '../../../ui/parts/ResultMessage';
import { ScrollSheet } from '../../../ui/sheets/ScrollSheet';
import { SheetButtons } from '../../../ui/sheets/SheetButtons';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

/**
 * ライブラリの「動画追加」「tagビデオ追加」（元の AddVideoSheet）。このサーバーのライブラリへ登録する。
 * 動画追加: 動画の場所・置き方（そのまま/移動/コピー）・パス形式・アルバム・シリーズ・話数・局・放送日時・ジャンル・カテゴリと詳細。
 * tagビデオ追加: tag.json か動画のパスから。アップロードは Web はブラウザ、iOS は「ファイル」から選ぶ。
 * 状態と操作は useAddVideo、入力は ManualVideoFields / TagVideoFields。preset は最初から埋めておく欄（アルバムの中から開いた時のアルバム・シリーズ）
 */
export function AddVideoSheet({ mode, open, onClose, onAdded, preset }: {
  mode: 'manual' | 'tag'; open: boolean; onClose: () => void; onAdded: () => void; preset?: Partial<AddVideoForm>;
}) {
  const { t: tx } = useT();
  const a = useAddVideo(mode, open, onAdded, preset);
  return (
    <ScrollSheet open={open} onClose={onClose} busy={a.busy} tall>
      <T size={13} w={800}>{a.manual ? tx('library.menu.addVideo') : tx('library.menu.addTag')}</T>
      <T mono size={10} dim style={styles.mb10}>
        {a.manual ? 'ファイルサイズ・再生時間・サムネイル（代表＋シークバー用タイル）は自動で作ります' : tx('library.addVideoSheet.readsTagJsonMetadata')}
      </T>
      {a.manual ? <ManualVideoFields a={a} /> : <TagVideoFields a={a} />}
      <ResultMessage msg={a.msg} style={styles.msg} />
      <SheetButtons onClose={onClose} onSubmit={() => void a.submit()} busy={a.busy} canSubmit={a.canSubmit} label={a.busy ? tx('common.registering') : tx('common.register')} />
    </ScrollSheet>
  );
}

const styles = StyleSheet.create({
  mb10: { marginBottom: 10, marginTop: 2 },
  msg: { marginTop: 10 } });
