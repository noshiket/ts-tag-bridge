import type { StreamMeta } from '@tstag/core';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { CaptureTab } from './CaptureTab';
import { ChapterTab } from './ChapterTab';
import { ClipTab } from './clip/ClipTab';
import { CommentTab } from './CommentTab';
import { ConfirmedTab, RecConfirmedTab } from './ConfirmedTab';
import { LogoTab } from './logo/LogoTab';
import { MusicInfo } from './MusicInfo';
import { PatternTab } from './PatternTab';
import { GenericAddonTab } from './playerTabAddons';
import { ProgramInfo } from './ProgramInfo';
import { SeriesTab } from './SeriesTab';
import { SplitTab } from '../../split/tab/SplitTab';
import type { useWatchTabs } from './watchTabs';
import { useT } from '../../../ui/i18n/I18n';

/** PC の並びの右パネルの幅（元の既定） */
const PANEL_WIDTH = 240;

/**
 * 再生画面のパネル（元の LiveRightPanel）: タブの並びと、開いているタブの中身。
 * PC・横持ちは映像の右、縦持ちは映像の下（wide で切り替える）
 */
export function WatchSidePanel(p: {
  tabs: ReturnType<typeof useWatchTabs>;
  wide: boolean;
  /** 帯に縮めている間は隠す（消すと開き直しが重い） */
  hidden?: boolean;
  meta: StreamMeta | undefined;
  isMusic: boolean;
  rec: boolean;
  videoId: number;
  node: string | null;
  time: number;
  playing: boolean;
  seek: (sec: number) => void;
  pause: () => void;
  comments: ComponentProps<typeof CommentTab>['comments'];
  /** コメントのトラックの切り替え（取り込んだ追加のトラックがある時だけ。無ければ null） */
  commentTracks: string[] | null;
  commentTrack: string;
  onCommentTrack: (t: string) => void;
  commentsOn: boolean;
  onToggleComments: () => void;
  captures: ComponentProps<typeof CaptureTab>['captures'];
  onCapture: ComponentProps<typeof CaptureTab>['onCapture'];
  onPlayCaptureAt: ComponentProps<typeof CaptureTab>['onPlayAt'];
  series: ComponentProps<typeof SeriesTab>['series'];
  onPlaySeries: ComponentProps<typeof SeriesTab>['onPlay'];
  /** 分割（録画だけ）。src が無い間は読み込み中か取得エラー */
  split: { ready: boolean; error: string | null } & Pick<ComponentProps<typeof SplitTab>, 'editor' | 'ctl'>;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { tabs, tab, tabAddon, tabLabel, selectTab } = p.tabs;
  const { rec, videoId, node } = p;
  return (
    // data-player-panel: この中を操作している間は再生画面のキー操作を使わない（usePlayerKeys）
    <View {...({ dataSet: { playerPanel: '1' } } as object)} style={[styles.side, { backgroundColor: theme.bg },
      p.wide ? { width: PANEL_WIDTH, borderLeftWidth: 1, borderLeftColor: theme.line } : styles.sideBelow, p.hidden && styles.hidden]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}
        style={[styles.tabBar, { borderBottomColor: theme.line }]}>
        {tabs.map((t) => (
          <Pressable key={t} onPress={() => selectTab(t)}
            style={[styles.tab, { borderColor: theme.line, backgroundColor: tab === t ? accent.primary : 'transparent' }]}>
            <T size={11} w={700} color={tab === t ? '#fff' : theme.mute}>{tabLabel(t)}</T>
          </Pressable>
        ))}
      </ScrollView>
      {/* コメントは件数が多く、一覧の中でスクロールするので外側を ScrollView にしない */}
      {tab === 'comment' ? (
        <View style={styles.panel}>
          <CommentTab comments={p.comments} time={p.time} commentsOn={p.commentsOn}
            tracks={p.commentTracks} track={p.commentTrack} onTrackChange={p.onCommentTrack}
            onToggleComments={p.onToggleComments} onSeek={p.seek} />
        </View>
      ) : tab === 'capture' ? (
        <View style={styles.panel}>
          <CaptureTab captures={p.captures} albumId={p.meta?.album_id} node={node}
            onCapture={p.onCapture} onPlayAt={p.onPlayCaptureAt} canCapture />
        </View>
      ) : tabAddon ? (
        // アドオンのタブ: アドオンが名乗る部品（player_ui）で中身を選ぶ。名乗らない・知らない部品なら汎用の画面
        <View style={styles.panel}>
          {tabAddon.player_ui === 'chapters' && !rec ? (
            <ChapterTab key={tabAddon.name} addon={tabAddon} videoId={videoId} node={node} now={() => p.time} onSeek={p.seek} />
          ) : tabAddon.player_ui === 'clip_range' && !rec ? (
            <ClipTab key={tabAddon.name} addon={tabAddon} videoId={videoId} node={node} time={p.time} playing={p.playing}
              pause={p.pause} seek={p.seek} />
          ) : tabAddon.player_ui === 'logo_rect' && rec ? (
            <LogoTab key={tabAddon.name} addon={tabAddon} dbRecId={videoId} node={node} />
          ) : (
            <GenericAddonTab key={tabAddon.name} addon={tabAddon} id={videoId} rec={rec} node={node} />
          )}
        </View>
      ) : tab === 'pattern' ? (
        <View style={styles.panel}>
          <PatternTab meta={p.meta} videoId={videoId} />
        </View>
      ) : tab === 'split' && rec ? (
        <View style={styles.panel}>
          {p.split.ready ? <SplitTab dbRecId={videoId} node={node} editor={p.split.editor} ctl={p.split.ctl} />
            : <T size={12} dim style={styles.todo}>{p.split.error ? tx('common.fetchError', { v0: p.split.error }) : tx('common.loading2')}</T>}
        </View>
      ) : tab === 'confirmed' ? (
        <View style={styles.panel}>
          {rec ? <RecConfirmedTab dbRecId={videoId} node={node} onGotoPattern={() => selectTab('pattern')} />
            : <ConfirmedTab videoId={videoId} node={node} onGotoPattern={() => selectTab('pattern')} />}
        </View>
      ) : tab === 'series' ? (
        <View style={styles.panel}>
          <SeriesTab series={p.series} currentId={videoId} node={node} onPlay={p.onPlaySeries} />
        </View>
      ) : (
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.panel}>
          {tab === 'program' && p.meta ? (p.isMusic
            ? <MusicInfo meta={p.meta} videoId={videoId} node={node} onEdit={() => selectTab('confirmed')} />
            : <ProgramInfo meta={p.meta} rec={rec} videoId={videoId} node={node} time={p.time} onEdit={() => selectTab('confirmed')} />) : null}
          {tab !== 'program' && <T size={12} dim style={styles.todo}>{tx('player.watchSidePanel.isntNewAppYet', { v0: tabLabel(tab) })}</T>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  side: { overflow: 'hidden' },
  sideBelow: { flex: 1 },
  tabBar: { flexGrow: 0, borderBottomWidth: 1 },
  tabs: { gap: 8, padding: 12 },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  panel: { flex: 1 },
  hidden: { display: 'none' },
  todo: { textAlign: 'center', padding: 40 },
});
