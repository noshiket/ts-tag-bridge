import type { Messages } from '../translate';

export const shell = {
  'shell.miniPlayerBar.playing': '再生中',
  'shell.miniPlayerBar.player': '再生画面へ',
  'shell.miniPlayerBar.watchingLive': 'ライブ視聴中',
  'shell.miniPlayerBar.next': '次へ',
  'shell.playerHost.couldntGetChannelList': 'チャンネル一覧の取得に失敗しました: {v0}',
  'shell.playerHost.channelCantWatchedLive': 'このチャンネルはライブ視聴できません（チューナーに未登録の局です）',
} satisfies Messages;
