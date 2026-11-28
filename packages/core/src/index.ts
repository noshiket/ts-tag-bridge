import { adminApi } from './admin/users';
import { authApi } from './auth/api';
import { autoAddApi } from './autoadd/api';
import { autoEncodeApi } from './autoencode/autoEncode';
import { confirmedApi } from './confirmed/api';
import { encodeInfoApi } from './encodeinfo/encodeInfo';
import { encodesApi } from './encodes/api';
import { localSaveApi as localSaveApiOf } from './localsave/localSave';
import { epgApi } from './epg/api';
import { patternsApi } from './patterns/api';
import { liveApi } from './live/live';
import { recSettingApi } from './recsetting/api';
import { recordingsApi } from './recordings/api';
import { reservesApi } from './reserves/api';
import { amatsukazeApi } from './settings/amatsukaze';
import { settingsApi } from './settings/api';
import { ApiClient, type ClientConfig } from './http/client';
import { audioCompareApi } from './library/audioCompare';
import { libraryApi } from './library/api';
import { musicApi } from './music/music';
import { addVideoApi } from './library/addVideo';
import { videoActionsApi } from './library/videoActions';
import { mylistApi } from './library/mylist';
import { nodesApi } from './nodes/api';
import { prefsApi } from './prefs/api';
import { streamApi } from './stream/api';
import { captionsApi } from './stream/captions';
import { commentsApi } from './stream/comments';
import { marksApi } from './stream/navigation';
import { watchApi } from './watch/api';
import { i18nApi } from './i18n/translate';


/** 画面から使う API の入口。分野ごとにまとめる */
export function createApi(config: ClientConfig) {
  const client = new ApiClient(config);
  return {
    client,
    auth: authApi(client),
    admin: adminApi(client),
    settings: settingsApi(client),
    amatsukaze: amatsukazeApi(client),
    library: libraryApi(client),
    videoActions: videoActionsApi(client),
    audioCompare: audioCompareApi(client),
    addVideo: addVideoApi(client),
    music: musicApi(client),
    mylist: mylistApi(client),
    prefs: prefsApi(client),
    nodes: nodesApi(client),
    stream: streamApi(client),
    comments: commentsApi(client),
    captions: captionsApi(client),
    marks: marksApi(client),
    watch: watchApi(client),
    reserves: reservesApi(client),
    recordings: recordingsApi(client),
    encodes: encodesApi(client),
    localSave: localSaveApiOf(client),
    patterns: patternsApi(client),
    confirmed: confirmedApi(client),
    recSetting: recSettingApi(client),
    autoEncode: autoEncodeApi(client),
    encodeInfo: encodeInfoApi(client),
    epg: epgApi(client),
    autoAdd: autoAddApi(client),
    live: liveApi(client),
    i18n: i18nApi(client),
  };
}

export type Api = ReturnType<typeof createApi>;

// 役割ごとの外へ出す名前（中身は src/exports/）
export * from './exports/stream';
export * from './exports/library';
export * from './exports/recording';
export * from './exports/patterns';
export * from './exports/settings';
export * from './i18n/translate';
export * from './i18n/ja';
