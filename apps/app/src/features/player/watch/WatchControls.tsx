import type { AudioViz, StreamMeta } from '@tstag/core';
import type { useStreamMarks } from '@tstag/core/react';
import type { RefObject } from 'react';

import type { useControlsVisibility } from './playerSideEffects';
import type { CommentLayers } from './useCommentLayers';
import type { useWatchSplit } from './useWatchSplit';
import { PlayerControls, playerLabel } from '../PlayerControls';
import type { VideoSurfaceHandle } from '../surface';
import type { usePlayback } from '../usePlayback';
import type { usePlayerDevicePrefs } from '../usePlayerDevicePrefs';
import type { useRotation } from '../useRotation';
import { SplitBarMarks } from '../../split/SplitBarMarks';


/** 再生画面の操作の表示（PlayerControls）に、この画面の状態と操作をつなぐ。触るたびに表示を出し直す（bump） */
export function WatchControls(o: {
  ui: ReturnType<typeof useControlsVisibility>; title: string; videoId: number; rec: boolean; pb: ReturnType<typeof usePlayback>; meta: StreamMeta | undefined;
  playing: boolean; time: { current: number; buffered: number }; duration: number; rate: number; setRate: (r: number) => void;
  chapters: { sec: number }[]; marks: ReturnType<typeof useStreamMarks>['data']; showSync: boolean; waveform: AudioViz['peaks'] | null;
  surface: RefObject<VideoSurfaceHandle | null>; split: ReturnType<typeof useWatchSplit>; layers: CommentLayers; prefs: ReturnType<typeof usePlayerDevicePrefs>;
  prevChapter: () => void; nextChapter: () => void; back: () => void; togglePlay: () => void; skip: (sec: number) => void;
  fullscreen: boolean; toggleFullscreen: () => void; rot: ReturnType<typeof useRotation>; isPC: boolean; panelOpen: boolean; setPanelOpen: (f: (x: boolean) => boolean) => void;
  onMore: () => void;
  /** 音声トラックのボタン。配信は ?audio= で受け直し、端末保存はプレイヤーのトラックを選ぶので、呼び出し側で決める */
  hasSecondaryAudio: boolean; secondaryAudio: boolean; onToggleAudio: () => void;
}) {
  const { ui, pb, meta, surface, split, layers, prefs, rot } = o;
  const { bump } = ui;
  const { marks } = o;
  return (
    <PlayerControls
      visible={ui.visible}
      waveform={o.waveform}
      title={o.title}
      label={playerLabel(o.videoId, pb.quality, pb.direct, o.rec)}
      playing={o.playing}
      current={o.time.current}
      duration={o.duration}
      buffered={o.time.buffered}
      rate={o.rate}
      hasSecondaryAudio={o.hasSecondaryAudio}
      secondaryAudio={o.secondaryAudio}
      chapters={o.chapters.map((c) => c.sec)}
      drops={marks?.drops}
      scramble={marks?.scramble}
      // 取り込み区間はコメントタブを開いている時だけ（元と同じ）
      sync={o.showSync ? marks?.sync : undefined}
      thumbnail={pb.thumbnail}
      onPrevChapter={() => { o.prevChapter(); bump(); }}
      onNextChapter={() => { o.nextChapter(); bump(); }}
      onBack={o.back}
      onTogglePlay={() => { o.togglePlay(); bump(); }}
      onSkip={(sec) => { o.skip(sec); bump(); }}
      onSeek={(sec) => { surface.current?.seek(sec); split.setFocusT(sec); }}
      seekExtra={split.active ? (w) => <SplitBarMarks editor={split.editor} duration={o.duration} barWidth={w} /> : undefined}
      onScrub={(a) => { ui.hold.current = a; if (!a) bump(); }}
      onResetRate={() => o.setRate(1)}
      onToggleAudio={o.onToggleAudio}
      hasCaption={!!meta?.has_caption}
      captionOn={layers.captionOn}
      onToggleCaption={layers.toggleCaption}
      commentsOn={layers.commentsOn}
      onToggleComments={layers.toggleComments}
      onPip={() => surface.current?.startPictureInPicture()}
      fullscreen={o.fullscreen}
      onToggleFullscreen={() => { o.toggleFullscreen(); bump(); }}
      rotated={!rot.available || o.isPC || o.fullscreen ? undefined : rot.on}
      onRotate={() => { rot.toggle(); bump(); }}
      panelOpen={o.isPC && !o.fullscreen ? o.panelOpen : undefined}
      onTogglePanel={() => o.setPanelOpen((x) => !x)}
      onMore={o.onMore}
      volume={prefs.volume}
      muted={prefs.muted}
      onVolume={(v) => { prefs.changeVolume(v); bump(); }}
      onVolumeDone={(v) => { prefs.changeVolume(v); prefs.saveVolume(v); }}
      onToggleMute={() => { prefs.toggleMute(); bump(); }}
    />
  );
}
