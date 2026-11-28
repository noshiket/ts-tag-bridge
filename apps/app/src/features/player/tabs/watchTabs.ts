import { tNow } from '../../../ui/i18n/I18n';
import type { MsgKey } from '@tstag/core';
import type { StreamMeta } from '@tstag/core';
import { useState } from 'react';

import { deviceStore } from '../../../lib/device/deviceStore';
import { addonTabKey, isAddonTab, usePlayerTabAddons, type AddonTabKey } from './playerTabAddons';

/** 下の切り替え（元の Web 版の並び）。まだ作っていないものは開くとその旨を出す */
const TABS = {
  program: 'common.program', comment: 'common.comments2', capture: 'library.tab.captures', series: 'common.series',
  confirmed: 'player.watchTabs.confirmed', pattern: 'player.watchTabs.pattern', split: 'common.split',
} as const satisfies Record<string, MsgKey>;
// 切り抜き・チャプター・ロゴなどはアドオン（target='player_tab'）が増やすタブ。名前で決め打ちせず、
// 有効なアドオンの一覧から組む（見出しはアドオンの tab_label、中身はアドオンが名乗る player_ui）
export type TabKey = keyof typeof TABS | AddonTabKey;
/** 音楽の時のタブの名前（元と同じ） */
const MUSIC_TABS: Partial<Record<TabKey, MsgKey>> = { program: 'player.watchTabs.trackInfo', series: 'library.tab.albums', confirmed: 'player.watchTabs.editTrackInfo' };
/** 音楽では出さないタブ（元と同じ。アドオンのタブも出さない） */
const NOT_FOR_MUSIC = new Set<TabKey>(['capture', 'pattern']);
/** 最後に開いていたタブ（端末ごと。毎回コメントに戻ると、番組情報などを見る人に毎回1手増える。元と同じ） */
const PANEL_TAB_KEY = 'tstag_player_panel_tab';
const savedTab = (): TabKey => {
  const t = deviceStore.get(PANEL_TAB_KEY);
  return t && (t in TABS || isAddonTab(t)) ? (t as TabKey) : 'comment';
};

/**
 * 再生画面のパネルのタブ: その動画で出すタブの並び、開いているタブ、その見出し。
 * コメントの無い動画はコメント、シリーズに入っていない動画はシリーズを出さない（元と同じ）。
 * 覚えていたタブが無い動画では番組情報を開く
 */
export function useWatchTabs(meta: StreamMeta | undefined, rec: boolean, node: string | null, hasExtraComments = false) {
  const [wanted, setWanted] = useState(savedTab);
  const selectTab = (t: TabKey) => { deviceStore.set(PANEL_TAB_KEY, t); setWanted(t); };
  const isMusic = meta?.media_kind === 'audio';
  const addonTabs = usePlayerTabAddons(node, rec, isMusic);
  const tabs: TabKey[] = [...(Object.keys(TABS) as (keyof typeof TABS)[]).filter((t) =>
    // 取り込んだコメント（追加のトラック）しか無い動画でもコメントを出す（元と同じ）
    (t !== 'comment' || !meta || meta.comment_count > 0 || hasExtraComments) && (t !== 'series' || meta?.series_id != null)
    // 録画: シリーズはライブラリの動画だけ（元と同じ）
    && !(rec && t === 'series')
    // 分割は元の TS を使うので録画だけ
    && (t !== 'split' || rec)
    // 音楽はキャプチャ・パターンを出さない
    && !(isMusic && NOT_FOR_MUSIC.has(t))),
    ...addonTabs.map((a) => addonTabKey(a.name))];
  const tab: TabKey = tabs.includes(wanted) ? wanted : 'program';
  // 開いているアドオンのタブ（無ければ null）
  const tabAddon = isAddonTab(tab) ? addonTabs.find((a) => addonTabKey(a.name) === tab) ?? null : null;
  const tabLabel = (t: TabKey) => {
    if (isAddonTab(t)) { const a = addonTabs.find((x) => addonTabKey(x.name) === t); return a?.tab_label || a?.label || t.slice('addon:'.length); }
    return tNow((isMusic && MUSIC_TABS[t]) || TABS[t]);
  };
  return { tabs, tab, tabAddon, tabLabel, selectTab };
}
