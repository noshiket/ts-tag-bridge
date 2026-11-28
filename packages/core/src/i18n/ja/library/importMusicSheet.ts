import type { Messages } from '../../translate';

export const libraryImportMusicSheet = {
  'library.importMusicSheet.noAudioFilesFound': '音声ファイルが見つかりませんでした',
  'library.importMusicSheet.scanFailed': '走査に失敗しました',
  'library.importMusicSheet.putSourceFolder': '変換元と同じフォルダに置く',
  'library.importMusicSheet.importMusic': '♪ 音楽を取り込む',
  'library.importMusicSheet.convertsAudioFilesFolder': 'フォルダの中の音声ファイル(aiff/flac/mp3/m4a/wav/opus/ogg)を再生用のMP4へ変換して登録します。原本はそのまま残ります。アーティストがアルバム、アルバムがその中の並びになります。',
  'library.importMusicSheet.artist': '/mnt/music/アーティスト名',
  'library.importMusicSheet.placedEncodeDirFolder': 'app_output_path_format で決めた {$encode_dir}/{$folder}/{$title}/{$episode_number} {$episode_name}.mp4 （アーティスト/アルバム/番号 曲名）へ入れます。原本は動かしません。',
  'library.importMusicSheet.checking': '確認中…',
  'library.importMusicSheet.checkContents': '① 中身を確認する',
  'library.importMusicSheet.noEmbeddedCoverArt': 'ジャケットが埋め込まれていません',
  'library.importMusicSheet.registered': '登録済み',
  'library.importMusicSheet.importing': '取り込み中…',
  'library.importMusicSheet.importTracksFewSeconds': '② {v0}曲を取り込む（1曲あたり数秒）',
} satisfies Messages;
