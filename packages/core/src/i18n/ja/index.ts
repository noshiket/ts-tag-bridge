import type { Messages } from '../translate';
import { nav } from './nav';
import { title } from './title';
import { libraryManualVideoDetails } from './library/manualVideoDetails';
import { libraryManualVideoFields } from './library/manualVideoFields';
import { libraryAlbumSheets } from './library/albumSheets';
import { libraryImportMusicSheet } from './library/importMusicSheet';
import { libraryMusicDrill } from './library/musicDrill';
import { libraryMusicSheets } from './library/musicSheets';
import { libraryUseVideoMaintenance } from './library/useVideoMaintenance';
import { libraryVideoActionList } from './library/videoActionList';
import { libraryAlbum } from './library/album';
import { libraryVideo } from './library/video';
import { libraryMenu } from './library/menu';
import { libraryLocal } from './library/local';
import { libraryMusic } from './library/music';
import { libraryMisc } from './library/misc';
import { recresult } from './recresult';
import { reservations } from './reservations';
import { filter } from './filter';
import { common } from './common';
import { settingsUserPermEditor } from './settings/userPermEditor';
import { settingsAddonsTab } from './settings/addonsTab';
import { settingsFilterSection } from './settings/filterSection';
import { settingsOptionSections } from './settings/optionSections';
import { settingsAppTab } from './settings/appTab';
import { settingsBasicSections } from './settings/basicSections';
import { settingsConfigEditor } from './settings/configEditor';
import { settingsDetailSections } from './settings/detailSections';
import { settingsFederationGuide } from './settings/federationGuide';
import { settingsFederationSection } from './settings/federationSection';
import { settingsServerCardFields } from './settings/serverCardFields';
import { settingsLocalCacheSection } from './settings/localCacheSection';
import { settingsLogoTab } from './settings/logoTab';
import { settingsAccount } from './settings/account';
import { settingsMisc } from './settings/misc';
import { settingsGeneral } from './settings/general';
import { view } from './view';
import { unit } from './unit';
import { date } from './date';
import { state } from './state';
import { system } from './system';
import { sort } from './sort';
import { epg } from './epg';
import { addons } from './addons';
import { autoReserve } from './autoReserve';
import { detail } from './detail';
import { encoding } from './encoding';
import { live } from './live';
import { patterns } from './patterns';
import { player } from './player';
import { recordingDetail } from './recordingDetail';
import { recSetting } from './recSetting';
import { search } from './search';
import { shell } from './shell';
import { split } from './split';
import { screens } from './screens';
import { ui } from './ui';
import { fmt } from './fmt';

/**
 * 日本語の辞書（アプリの文の元）。キーは「場所.部品.中身」（短い共通の文は common.*）。場所ごと（大きい場所は部品ごと）のファイルに分けてある。
 * 言語アドオンは同じキーで訳を持つ（server/addon/lang_en/messages/ が見本）。文を足す時は、その画面のファイルに足して t('キー') で引く
 */
export const JA = {
  ...nav,
  ...title,
  ...libraryManualVideoDetails,
  ...libraryManualVideoFields,
  ...libraryAlbumSheets,
  ...libraryImportMusicSheet,
  ...libraryMusicDrill,
  ...libraryMusicSheets,
  ...libraryUseVideoMaintenance,
  ...libraryVideoActionList,
  ...libraryAlbum,
  ...libraryVideo,
  ...libraryMenu,
  ...libraryLocal,
  ...libraryMusic,
  ...libraryMisc,
  ...recresult,
  ...reservations,
  ...filter,
  ...common,
  ...settingsUserPermEditor,
  ...settingsAddonsTab,
  ...settingsFilterSection,
  ...settingsOptionSections,
  ...settingsAppTab,
  ...settingsBasicSections,
  ...settingsConfigEditor,
  ...settingsDetailSections,
  ...settingsFederationGuide,
  ...settingsFederationSection,
  ...settingsServerCardFields,
  ...settingsLocalCacheSection,
  ...settingsLogoTab,
  ...settingsAccount,
  ...settingsMisc,
  ...settingsGeneral,
  ...view,
  ...unit,
  ...date,
  ...state,
  ...system,
  ...sort,
  ...epg,
  ...addons,
  ...autoReserve,
  ...detail,
  ...encoding,
  ...live,
  ...patterns,
  ...player,
  ...recordingDetail,
  ...recSetting,
  ...search,
  ...shell,
  ...split,
  ...screens,
  ...ui,
  ...fmt,
} satisfies Messages;

export type MsgKey = keyof typeof JA;
