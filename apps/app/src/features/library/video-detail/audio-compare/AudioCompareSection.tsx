import type { Video } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { CompareJobView } from './CompareJobView';
import { CompareSourcePicker } from './CompareSourcePicker';
import { CMP_RED, CmpBtn } from './compareParts';
import { AddedTrackList, SyncRecords } from './SyncHistory';
import { useAudioCompare } from './useAudioCompare';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 字幕・実況コメントの取り込みと削除（元の AudioCompareSheet）。同じ番組の別の放送と音声を比べ、共通の区間の字幕・コメントを
 * この動画へ移す。取り込んだ時の時間の対応と、取り込んだトラック（消せる）も見せる。解析中に閉じても、開き直すと続きを追う
 */
export function AudioCompareSection({ video, onClose, onApplied }: { video: Video; onClose: () => void; onApplied: () => void }) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  const a = useAudioCompare(video, onApplied);
  return (
    <View style={styles.wrap}>
      <T size={12} w={800}>{tx('common.importDeleteCaptionsComments')}</T>
      <T mono size={9} dim>{tx('library.audioCompareSection.comparesAudioAnotherBroadcast')}</T>
      {!a.job && (
        <>
          <SyncRecords records={a.records} />
          <AddedTrackList tracks={a.tracks} busy={a.busy} onDelete={(body, label) => void a.delTrack(body, label)} />
          <CompareSourcePicker a={a} records={a.records} />
        </>
      )}
      {a.job && <CompareJobView job={a.job} dur={video.duration_sec || 0} onBack={() => { a.setJob(null); a.setMsg(''); }} />}
      {!!a.msg && <T size={10} color={a.msg.startsWith(tx('common.imported')) || a.msg.startsWith(tx('library.audioCompareSection.previous')) ? accent.primary : CMP_RED}>{a.msg}</T>}
      <CmpBtn onPress={onClose} big>{tx('common.close')}</CmpBtn>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
});
