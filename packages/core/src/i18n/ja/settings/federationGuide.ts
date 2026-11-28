import type { Messages } from '../../translate';

export const settingsFederationGuide = {
  'settings.federationGuide.otherServer': '④ 相手のサーバーでやること',
  'settings.federationGuide.otherServersAppOpen': '相手のサーバーのアプリで「設定 → アプリ → 詳細設定を表示 → サーバー間連携」を開いて:',
  'settings.federationGuide.copySharedSecret': '合言葉をコピー',
  'settings.federationGuide.copy': 'URL をコピー',
  'settings.federationGuide.useDifferentSecretDestination': '送り先だけ別の合言葉にする',
  'settings.federationGuide.destinationOnlySecret': '送り先だけの合言葉',
  'settings.federationGuide.onlyWhenDestinationUses': '送り先が ② と別の合言葉を使う時だけ。空欄なら ② を使う',
  'settings.federationGuide.patternSync': 'パターンの同期',
  'settings.federationGuide.syncing': '同期中...',
  'settings.federationGuide.resendAllPatterns': 'パターンを全部送り直す',
  'settings.federationGuide.pasteSameValueServer': '②「合言葉」に、このサーバーと同じ値を貼る',
  'settings.federationGuide.ifOtherServerDestination': '相手が送り先なら、ここまでで受け取れます（③ は空のままでよい）',
  'settings.federationGuide.viewServerThereToo': '相手からもこのサーバーを見たい時は、相手の ③-B に 名前「{v0}」・URL「{v1}」を足す',
  'settings.federationGuide.pressSaveSettingsThere': '相手でも「設定を保存」を押す。両方で保存したら、③ の「接続テスト」で確かめられます',
  'settings.federationGuide.addingEditingPatternsProgram': 'パターン（番組名の解析のきまり）を足したり直したりすると、連携しているサーバーにも自動で届きます。新しく連携した時、片方にパターンが1つも無ければ自動でそろいます（両方にある時は混ぜません）。こちらの全部を送り直したい時だけ下を押してください。',
} satisfies Messages;
