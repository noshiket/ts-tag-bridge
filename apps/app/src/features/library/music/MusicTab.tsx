import { View } from 'react-native';

import { MusicDrill } from './MusicDrill';
import { MusicLists } from './MusicLists';
import { musicStyles as ms } from './musicControls';
import { MusicMessage } from './musicParts';
import { MusicSheets } from './MusicSheets';
import { useMusicLibrary } from './useMusicLibrary';

/**
 * ライブラリの「ミュージック」（元の encode.jsx の MusicList）: 最近の再生 / プレイリスト / アーティスト / アルバム / 曲 の一覧と、
 * アーティスト・アルバム・プレイリスト・フォルダの中身。押すとその並びを積んで再生（前/次・曲の終わりはその並びで送る）。
 * お気に入り（★）、プレイリストの作成・フォルダ・並べ替え・追加と外す、曲の tag.json と削除。
 * ローカル保存（曲の「…」から）。保存した曲は保存から鳴らす。「ローカル」はこの端末に保存した曲。
 * 状態と操作は useMusicLibrary、一覧は MusicLists、掘り下げは MusicDrill、シートは MusicSheets
 */
export function MusicTab() {
  const m = useMusicLibrary();
  return (
    <View style={ms.pad}>
      <MusicSheets m={m} />
      {/* フォルダの中では知らせを出さない（元と同じ） */}
      {m.drill?.kind !== 'folder' && <MusicMessage m={m} />}
      {m.drill ? <MusicDrill m={m} drill={m.drill} /> : <MusicLists m={m} />}
    </View>
  );
}
