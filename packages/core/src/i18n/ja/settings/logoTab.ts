import type { Messages } from '../../translate';

export const settingsLogoTab = {
  'settings.logoTab.errors': ' エラー: {n}件',
  'settings.logoTab.cacheCleared': 'キャッシュ削除: {v0}件',
  'settings.logoTab.fetchFetchEdcb': 'EDCBから取得\nfetch_edcb()',
  'settings.logoTab.clearCacheClearCache': 'キャッシュ削除\nclear_cache()',
  'settings.logoTab.whenLogosCantFetched': 'ロゴが取れない時の設定',
  'settings.logoTab.settingsWhenBsCs': 'BS/CSロゴが取得できない場合の設定',
  'settings.logoTab.settingsRecordingAppEpgdatacap': '① 設定/録画アプリ(EpgDataCap_Bon)',
  'settings.logoTab.setLogoTypesSave': '{v0}「保存するロゴのタイプ」を',
  'settings.logoTab.settingsCaptureStartTime': '② 設定/EPG取得開始時間',
  'settings.logoTab.mostImportant': '← 最重要',
  'settings.logoTab.epgtimersrvIniBasiconlyflags0': 'EpgTimerSrv.ini: [EPG_CAP] BasicOnlyFlags=0\n※ デフォルト値(-1 や 7)のままだとCDT(ロゴ)が保存されない',
  'settings.logoTab.settingsCapture': '③ 設定/EPG取得',
  'settings.logoTab.stations': '{v0} — {v1} 局',
  'settings.logoTab.noLogo': 'ロゴなし',
  'settings.logoTab.leastOneSlotTurn': '少なくとも1スロットで「基本情報のみ取得するネットワーク」の{v0}BS・CS1・CS2・CS3 をすべてオフにする{v1}',
  'settings.logoTab.ifSLogoTypes': 'EDCBの「取得するロゴタイプ」がデフォルト(32=type5のみ)だとBS/CS含め多くの局が取得されない。\n全局対応するには 63(type0〜5) に設定すること。\n',
} satisfies Messages;
