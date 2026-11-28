import { Pressable, StyleSheet, View } from 'react-native';

import { Big, Chip, Label, formStyles as fs, useAddInput } from './addVideoParts';
import type { AddVideoState } from './useAddVideo';
import { Select } from '../../../ui/inputs/Select';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 動画の指定の仕方（サーバー上のパス / アップロード）。アップロードは保存先とファイルを選んで送る。動画追加と tag で共通 */
export function VideoSourcePicker({ a }: { a: AddVideoState }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const input = useAddInput();
  return (
    <>
      <View style={fs.row6}>
        {(['path', 'upload'] as const).map((k) => (
          <Chip key={k} on={a.src === k} onPress={() => { a.setSrc(k); a.clearMsg(); }}>{k === 'path' ? tx('library.videoSourcePicker.serverPath') : tx('library.videoSourcePicker.upload')}</Chip>
        ))}
      </View>
      {a.src === 'upload' && (
        <>
          <Label req>{tx('library.videoSourcePicker.destinationEncodeDirEncode')}</Label>
          <Select label={tx('common.destination')} value={a.destDir} options={a.rootOpts} onChange={a.setDestDir} />
          <T mono size={9} dim style={fs.hint}>
            {a.manual ? tx('library.videoSourcePicker.folderFileNamesCome')
              : tx('library.videoSourcePicker.folderFileNamesCome2')}
          </T>
          <Label req>{tx('library.videoSourcePicker.videoFile')}</Label>
          <Pressable onPress={() => void a.pickFile()} style={[input, styles.file]}><T mono size={11} dim={!a.upFile}>{a.upFile ? a.upFile.name : tx('library.videoSourcePicker.chooseFile')}</T></Pressable>
          {a.upPct != null && (
            <View style={styles.progRow}>
              <View style={[styles.prog, { backgroundColor: theme.line }]}><View style={{ width: `${Math.round(a.upPct * 100)}%`, height: '100%', backgroundColor: accent.primary }} /></View>
              <T mono size={9} dim>{`${Math.round(a.upPct * 100)}%`}</T>
            </View>
          )}
          <Big disabled={a.busy || !a.upFile || !a.destDir} onPress={() => void a.doUpload()}>{a.upPct != null ? tx('library.videoSourcePicker.uploading') : tx('library.videoSourcePicker.upload2')}</Big>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  file: { justifyContent: 'center' },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  prog: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
});
