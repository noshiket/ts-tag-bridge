import type { Messages } from '../../translate';

export const settingsServerCardFields = {
  'settings.serverCardFields.onlyWhenRunsDocker': '{v0} を Docker などで動かしていて、同じ録画が別の場所に見える時だけ。同じ場所に見えるなら空',
  'settings.serverCardFields.pathSeen': '{v0} から見た場所',
  'settings.serverCardFields.amatsukazeEncode': 'エンコードする Amatsukaze',
  'settings.serverCardFields.whereSRecordingsEncoded': 'この EDCB の録画をエンコードする所（下の Amatsukaze の名前）',
  'settings.serverCardFields.addAmatsukazeFirst': 'Amatsukaze を先に足してください',
  'settings.serverCardFields.encodeNamesChosenPer': '録画ごとに選ぶエンコードの名前と、それに使う Amatsukaze のプロファイル',
  'settings.serverCardFields.nameEGCmcut': '名前（例: cmcut）',
  'settings.serverCardFields.profile': 'プロファイル',
  'settings.serverCardFields.inputOutputPaths': '入力と出力の場所',
  'settings.serverCardFields.inputTs': '入力の TS',
  'settings.serverCardFields.output': '出力先',
  'settings.serverCardFields.add': '+ 指定を足す',
} satisfies Messages;
