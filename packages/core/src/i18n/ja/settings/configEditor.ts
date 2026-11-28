import type { Messages } from '../../translate';

export const settingsConfigEditor = {
  'settings.configEditor.restartMayHaveFailed': '再起動に失敗した可能性があります',
  'settings.configEditor.restartingServer': 'サーバーを再起動中...',
  'settings.configEditor.checkTagBridgeLog': '/tmp/ts-tag-bridge.log を確認してください',
  'settings.configEditor.waitingComeBackReconnects': '起動を確認しています（自動で復帰します）',
  'settings.configEditor.serverSettings': 'サーバー設定',
  'settings.configEditor.restartNeededApplyChanges': '変更の反映には再起動が必要です',
  'settings.configEditor.restartApply': '再起動して反映',
  'settings.configEditor.restartServerNow': 'サーバーを再起動',
  'settings.configEditor.restartServerNowSub': '止めてから起動し直します。エンコードや取り込みの途中なら、確かめてから',
  'settings.configEditor.hideAdvanced': '詳細設定を隠す ▲',
  'settings.configEditor.showAdvanced': '詳細設定を表示 ▼',
  'settings.configEditor.connectionsToolsWorkerIntervals': '接続・道具・ワーカーの間隔・解析の重さの数字・場所の対応・認証・サーバー間連携',
} satisfies Messages;
