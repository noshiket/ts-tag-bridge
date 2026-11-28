// ライブのプレイヤー本体（元の live.jsx の LivePlayer の、映像・字幕・弾幕・実況の部分）。
// Web はこのページの中で、iOS はサーバーを起点にした WebView の中で、同じこの素の JavaScript を動かす
// （iOS の標準プレイヤーは流しっぱなしの MPEG-TS を再生できないため、どちらも mpegts.js で再生する）。
// 操作ボタンと番組情報はアプリ側が描き、ここへは命令を送り、ここからは状態を送り返す。
//
// iOS の Hermes は関数のソースを持たない（toString が使えない）ので、文字列として持つ。
// 中で ` と ${ を使わないこと（このファイルのテンプレート文字列が壊れる）。
// 中身は役割ごとに livePage/ に分けてあり、ここで元の順につなぐ（つないだ文字列は分ける前と同じ）

import { PART as livePageLoad } from './livePage/livePageLoad';
import { PART as livePagePlayer } from './livePage/livePagePlayer';
import { PART as livePageComments } from './livePage/livePageComments';
import { PART as livePagePip } from './livePage/livePagePip';
import { PART as livePageControls } from './livePage/livePageControls';

export const LIVE_PAGE_JS = [livePageLoad, livePagePlayer, livePageComments, livePagePip, livePageControls].join('');
