import type { Messages } from '../../translate';

export const settingsLocalCacheSection = {
  'settings.localCacheSection.localCache': 'ローカルキャッシュ',
  'settings.localCacheSection.usedSavedVideos': '\n使用量（保存した動画）: ',
  'settings.localCacheSection.tempFilesSavingDevice': '\n端末へ保存・共有用の一時ファイル: ',
  'settings.localCacheSection.downloadMobileDataToo': 'モバイル通信でもダウンロードする',
  'settings.localCacheSection.downloadsWiFiMobile': 'Wi-Fi でもモバイル通信でも取ります',
  'settings.localCacheSection.waitsMobileDataDownloads': 'モバイル通信の間は待ち、Wi-Fi につながったら取ります（次に始めるダウンロードから）',
  'settings.localCacheSection.clearAllCache': 'キャッシュを全削除',
  'settings.localCacheSection.clearEntireCache': 'キャッシュを全削除しますか？',
  'settings.localCacheSection.deletesVideosPlaybackData': '端末に保存した動画と再生用データ、端末へ保存する時の一時ファイルをすべて消します。サーバーの動画と、「ファイル」「写真」へ保存した物は消えません。',
  'settings.localCacheSection.videosDownloadedLibraryTheir': 'ライブラリからダウンロードした動画とその再生用データ（弾幕・字幕・シークサムネ等）は{v0}に保存されます。',
} satisfies Messages;
