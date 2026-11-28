import type { Messages } from '../translate';

export const recordingDetail = {
  'recordingDetail.queueActions.addEncodeQueue': 'エンコードキューに追加',
  'recordingDetail.queueActions.stateCantQueuedWaiting': 'state={v0} は登録できません (waiting/error のみ)',
  'recordingDetail.queueActions.cantQueueNotDb': 'DB未登録のため登録できません',
  'recordingDetail.queueActions.tapAgainRunRemoves': 'もう一度タップで実行（既存キュー削除+再登録）',
  'recordingDetail.queueActions.removeEncodeQueueRe': 'エンコードキューを削除して再登録',
  'recordingDetail.recordingDetail.recordingDetails': '録画詳細',
  'recordingDetail.recordingDetail.split': '→ 分割画面',
  'recordingDetail.recordingHeaderCard.watchRecording': '録画再生',
  'recordingDetail.recordingHeaderCard.size': 'サイズ',
  'recordingDetail.recordingHeaderCard.recStart': '録画開始',
  'recordingDetail.recordingHeaderCard.recEnd': '録画終了',
  'recordingDetail.recordingHeaderCard.totalLength': '総再生時間',
  'recordingDetail.recordingHeaderCard.match': 'EIT一致率',
  'recordingDetail.recordingHeaderCard.resolution': '解像度',
  'recordingDetail.recordingHeaderCard.codec': 'コーデック',
} satisfies Messages;
