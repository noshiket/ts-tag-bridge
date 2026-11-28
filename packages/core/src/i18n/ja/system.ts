import type { Messages } from '../translate';

export const system = {
  'system.backend.noSavedData': '保存済みデータがありません',
  'system.downloadShare.couldntDownload': 'ダウンロードできませんでした',
  'system.downloadShare.appCantSaveFiles': 'このアプリでは保存できません（アプリを新しく入れ直すと使えます）',
  'system.snapshot.waiting': '待機中…',
  'system.writeVideoWeb.connectionStalled': '通信が止まりました',
  'system.pushPeer.notMoved': '移動されませんでした',
  'system.push.retry': '（移動予約済み。サーバーが自動で再試行します）',
} satisfies Messages;
