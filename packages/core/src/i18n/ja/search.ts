import type { Messages } from '../translate';

export const search = {
  'search.formParts.clear': '✕ クリア',
  'search.formParts.treat': 'NOT扱い',
  'search.formParts.subgenre': '{v0} / 中ジャンル',
  'search.searchPanel.archive': 'アーカイブ',
  'search.searchPanel.eGSpecialFeature': '例: 特集スペシャル AI',
  'search.searchPanel.search': '検索 /api/search',
  'search.searchPanel.clear': 'クリア',
  'search.searchPanel.createAutoReserveRule': 'この検索条件で自動予約ルールを作成',
  'search.panel.and': '— ANDキーワード（スペース区切り）',
  'search.panel.not': '— NOTキーワード',
  'search.panel.scramble': '— スクランブル',
  'search.panel.genre': '— ジャンル（複数選択可）',
  'search.panel.channel': '— チャンネル（複数可・省略=全局）',
  'search.panel.length': '— 番組長（分、0=指定なし）',
  'search.panel.days': '（0=全期間）',
} satisfies Messages;
