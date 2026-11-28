import type { Messages } from '../../translate';

export const libraryManualVideoDetails = {
  'library.manualVideoDetails.categoriesAlbumNameIf': 'カテゴリ（省略時はアルバム名）',
  'library.manualVideoDetails.remove': '外す',
  'library.manualVideoDetails.categoryName': 'カテゴリ名',
  'library.manualVideoDetails.hideDetails': '▲ 詳細を隠す',
  'library.manualVideoDetails.detailsProgramInfoBroadcast': '▼ 詳細（番組情報・放送識別・録画時刻）',
  'library.manualVideoDetails.summaryEitDescription': '番組概要 / eit_description',
  'library.manualVideoDetails.detailsEitExtendedInfo': '番組詳細 / eit_extended_info',
  'library.manualVideoDetails.videoEitVideoInfo': '映像 / eit_video_info',
  'library.manualVideoDetails.audioEitAudioInfo': '音声 / eit_audio_info',
  'library.manualVideoDetails.recordingStartRecordingStart': '録画開始 / recording_start_time',
  'library.manualVideoDetails.recordingEndRecordingEnd': '録画終了 / recording_end_time',
  'library.manualVideoDetails.settingSetting': '設定 / setting',
  'library.manualVideoDetails.newCc': '[新][字]',
  'library.manualVideoDetails.announcementAnnounce': 'テロップ告知 / announce',
  'library.manualVideoDetails.tagEdcbTag': 'EDCBタグ / edcb_tag',
  'library.manualVideoDetails.fileSizeDurationFilled': '※ file_size / duration はサーバー側で自動補完。tag.json は動画と同じ場所に生成されます。\n※ パス形式（app_output_path_format）は config.yml の output_path が自動で入ります。\n※ 日時は ISO8601（2026-07-17T00:00:00）。onid/tsid/sid は放送局から自動で決まり、局ロゴ表示と重複判定に使います。',
} satisfies Messages;
