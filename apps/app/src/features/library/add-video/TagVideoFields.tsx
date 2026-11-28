import { StyleSheet, View } from 'react-native';

import { Label, formStyles as fs, useAddInput } from './addVideoParts';
import type { AddVideoState } from './useAddVideo';
import { VideoSourcePicker } from './VideoSourcePicker';
import { HistoryInput } from '../../../ui/inputs/HistoryInput';
import { Switch } from '../../../ui/inputs/Switch';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

/** tagビデオ追加の入力: tag.json か動画のパス（アップロードなら送った後に入る）と、同じパスの既存の動画を差し替えるか */
export function TagVideoFields({ a }: { a: AddVideoState }) {
  const { t: tx } = useT();
  const input = useAddInput();
  return (
    <>
      <VideoSourcePicker a={a} />
      <Label req>{a.src === 'upload' ? tx('library.tagVideoFields.pathTagJsonVideo') : tx('library.tagVideoFields.pathTagJsonVideo2')}</Label>
      <HistoryInput histKey="tagjson_path" value={a.tagPath} onChangeText={(v) => { a.setTagPath(v); a.clearMsg(); }} placeholder={tx('common.1TitleMp4')} style={input} />
      <T mono size={9} dim style={fs.note}>
        {tx('library.tagVideoFields.givenVideoMp4Etc')}
      </T>
      <View style={styles.replace}>
        <Switch on={a.replace} onChange={() => a.setReplace(!a.replace)} label={tx('library.tagVideoFields.replaceExistingVideoSame')} />
        <T size={11} style={fs.f1}>{tx('library.tagVideoFields.replaceExistingVideoSame2')}</T>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  replace: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
});
