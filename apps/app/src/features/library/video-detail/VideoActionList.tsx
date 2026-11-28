import { StyleSheet, View } from 'react-native';

import { DETAIL_RED, DetailBig, DetailBtn, detailStyles } from './detailButtons';
import { okMsg, useVideoMaintenance } from './useVideoMaintenance';
import type { useVideoFileActions } from './useVideoFileActions';
import { VideoAddonSection } from './VideoAddonSection';
import { Trash } from '../../../ui/parts/Icons';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 詳細シートの操作の並び: 並べ替え・ダウンロード・ライブラリへ・解析値の操作・コメント/サムネイル・重複録画・
 * 字幕/実況の取り込み・tag.json・アドオン・連携先へ移動・削除
 */
export function VideoActionList({ p }: { p: {
  videoId: number; node: string | null; music: boolean; isMp4: boolean; inLibrary: boolean; peer: string | null; canPush: boolean;
  m: ReturnType<typeof useVideoMaintenance>; f: ReturnType<typeof useVideoFileActions>; refresh: () => void;
  onMove?: (dir: 'up' | 'down') => void; canMoveUp?: boolean; canMoveDown?: boolean;
  openCompare: () => void; openTag: () => void; askPush: () => void; askDelete: () => void;
} }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { m, f, node } = p;
  const busy = !!m.reparsing || m.applying;
  return (
    <>
      {p.onMove && (
        <>
          <View style={detailStyles.moves}>
            <DetailBig disabled={!p.canMoveUp} onPress={() => p.onMove!('up')}>{tx('library.videoActionList.up')}</DetailBig>
            <DetailBig disabled={!p.canMoveDown} onPress={() => p.onMove!('down')}>{tx('library.videoActionList.down')}</DetailBig>
          </View>
          <View style={[styles.rule, { borderTopColor: theme.line }]} />
        </>
      )}
      {/* 端末へ保存（tag.json・サムネを埋め込んだ動画）。iOS は落としてから共有シートで渡す（「ファイルに保存」など） */}
      {p.isMp4 && <DetailBtn onPress={() => void f.downloadVideo()}>{f.dlBusy ? tx('common.downloading') : tx('library.videoActionList.downloadDeviceTagEmbedded')}</DetailBtn>}
      {f.dlErr && <T mono size={10} color="#ef4444">{f.dlErr}</T>}
      {p.inLibrary && <DetailBtn onPress={() => void f.goLibrary()}>{tx('library.videoActionList.moveVideosLibrary')}</DetailBtn>}
      {/* 番組表から解析した値の操作。音楽は解析で作った値ではないので出さない */}
      {!p.music && (
        <View style={styles.group}>
          <View style={styles.wrap}>
            <DetailBtn inline disabled={busy} onPress={() => void m.reparse(false)}>{`↻ ${m.reparsing === 'cache' ? '再解析中…' : '解析値を再解析'}`}</DetailBtn>
            <DetailBtn inline disabled={busy} onPress={() => void m.reparse(true)}>{m.reparsing === 'fresh' ? tx('library.videoActionList.refetching') : tx('common.refetchReparse')}</DetailBtn>
            <DetailBtn inline disabled={busy} onPress={() => void m.applyParse()}>{`✓ ${m.applying ? '反映中…' : '解析値を確定値に反映'}`}</DetailBtn>
          </View>
          {!!m.applyMsg && <T mono size={9} color={okMsg(m.applyMsg) ? accent.primary : '#ef4444'} style={detailStyles.center}>{m.applyMsg}</T>}
        </View>
      )}
      {/* コメントの取り直しとサムネイルの作り直しはこのサーバーの動画だけ（元と同じ） */}
      {!node && (
        <View style={styles.group}>
          {!p.music && <DetailBtn disabled={m.cmtBusy} onPress={() => void m.refetchComments()}>{`⟳ ${m.cmtBusy ? '取り直し中…' : 'コメント再取得'}`}</DetailBtn>}
          <DetailBtn disabled={m.thumbBusy} onPress={() => void m.regenThumb()}>{`🖼 ${m.thumbBusy ? '作り直し中…' : 'サムネイル再生成'}`}</DetailBtn>
          {!!m.cmtMsg && <T mono size={9} color={okMsg(m.cmtMsg) ? accent.primary : theme.mute} style={detailStyles.center}>{m.cmtMsg}</T>}
          {!!m.thumbMsg && <T mono size={9} color={okMsg(m.thumbMsg) ? accent.primary : theme.mute} style={detailStyles.center}>{m.thumbMsg}</T>}
        </View>
      )}
      {/* 重複録画の許可: ON の動画と解析値が同じ予約は自動でスキップしない */}
      <DetailBtn on={f.allowDup} onPress={f.toggleDup}>{f.allowDup ? tx('library.videoActionList.duplicateRecordingAllowedNot') : tx('library.videoActionList.allowDuplicateRecording')}</DetailBtn>
      {/* 同じ番組の別の放送から字幕・実況を移す。解析はこのサーバーで行うので、他のサーバーの動画には出さない */}
      {p.isMp4 && !node && <DetailBtn onPress={p.openCompare}>{tx('common.importDeleteCaptionsComments')}</DetailBtn>}
      {/* tag.json: 確定値の編集に出ない項目（eit_start_time など）を直すため */}
      <DetailBtn onPress={p.openTag}>{tx('library.videoActionList.viewEditTagJson')}</DetailBtn>
      <VideoAddonSection videoId={p.videoId} node={node} onChanged={p.refresh} />
      {p.peer && p.canPush && <DetailBtn color={accent.tertiary} onPress={p.askPush}>{tx('library.videoActionList.move', { v0: p.peer })}</DetailBtn>}
      <DetailBtn color={DETAIL_RED} icon={<Trash s={10} c={DETAIL_RED} />} onPress={p.askDelete}>{tx('library.videoActionList.deleteLibrary')}</DetailBtn>
    </>
  );
}

const styles = StyleSheet.create({
  rule: { borderTopWidth: 1, marginBottom: 14 },
  group: { alignItems: 'center', gap: 4, marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
});
