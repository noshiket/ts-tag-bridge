import type { Messages } from '../../translate';

export const libraryAlbum = {
  'library.album.new': '新着',
  'library.album.count': '{n}本',
  'library.album.last': '最終 {date}',
  'library.album.mismatch': '⚠ 分類エラー {n}/{total}本 · フォルダ {folders}',
  'library.album.mylistAdd': 'マイリストに追加',
  'library.album.mylistRemove': 'マイリストから外す',
  'library.album.eps': '話',
  'library.album.epsSeasons': '話 / {n}期',
  'library.album.watchedOn': '{date} に見た',
  'library.album.empty': 'アルバムがありません',
  'library.album.emptyFiltered': '絞り込み条件に一致するアルバムがありません',
  'library.album.mode.album': 'アルバム',
  'library.album.mode.video': 'ビデオ',
  'library.album.menu.open': '開く',
  'library.album.menu.openSub': 'シリーズと動画を見る',
  'library.album.menu.mylistSub': 'ライブラリのマイリストタブに出ます',
  'library.album.menu.delete': 'アルバムを削除',
  'library.album.menu.deleteSub': '配下の動画・tag.json・サムネ・空フォルダごと消す',
  'library.album.filter.search': 'タイトルで絞り込み',
  'library.album.filter.broadcast': '放送日',
} satisfies Messages;
