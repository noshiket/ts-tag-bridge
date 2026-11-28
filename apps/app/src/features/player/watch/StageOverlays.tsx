import type { AudioViz } from '@tstag/core';
import type { ReactNode, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CommentLayers } from './useCommentLayers';
import { CaptionOverlay } from '../overlays/CaptionOverlay';
import { DanmakuOverlay } from '../overlays/DanmakuOverlay';
import { LogoRectOverlay } from '../overlays/LogoRectOverlay';
import { MusicSpectrum } from '../overlays/MusicSpectrum';
import { PosterOverlay, type PosterTarget } from '../overlays/PosterOverlay';
import { VideoRect } from '../overlays/VideoRect';
import type { VideoSurfaceHandle } from '../surface';
import { SplitFrameOverlay } from '../../split/SplitFrameOverlay';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 映像の上に重ねるもの: 再生が始まるまでのサムネ、音楽のスペクトラム、字幕、弾幕（映像の枠の中）、続けてタップの表示、音声のみ・読み込み中、
 * ロゴの範囲（ロゴのタブ）、分割の編集点のコマ（止めている間）
 */
export function StageOverlays({ layers, time, playing, rate, audioOnly, status, loadError, viz, now, surface, tapFeedback, logoRect, splitFrame, poster, aspect, band = false }: {
  layers: CommentLayers; time: number; playing: boolean; rate: number; audioOnly: boolean;
  status: { s: 'loading' | 'ready' | 'error'; msg?: string }; loadError: string | null;
  viz: AudioViz | null; now: () => number; surface: RefObject<VideoSurfaceHandle | null>; tapFeedback: ReactNode;
  logoRect: boolean; splitFrame: { dbRecId: number; t: number; node: string | null } | null; poster: PosterTarget;
  /** 映像の縦横比（幅 ÷ 高さ。弾幕を映像の上だけに流す） */
  aspect: number;
  /** 下の帯の枠に縮めている間（サムネ・弾幕・字幕だけ出す） */
  band?: boolean;
}) {
  const { t: tx } = useT();
  const { captionOn, captions, commentsOn, flowing, danmaku } = layers;
  const failed = status.s === 'error';
  return (
    <>
      {/* 音楽・音声のみはそれぞれの表示があるので出さない */}
      {!viz && !audioOnly && <PosterOverlay target={poster} started={status.s === 'ready' && playing} />}
      {viz && !failed && <MusicSpectrum viz={viz} now={now} playing={playing} />}
      {captionOn && captions && !audioOnly && <CaptionOverlay captions={captions} time={time} />}
      {commentsOn && flowing && !audioOnly && (
        <VideoRect aspect={aspect}>
          <DanmakuOverlay comments={flowing} time={time} playing={playing} rate={rate} {...danmaku}
            player={() => surface.current?.nativePlayer?.() ?? null} />
        </VideoRect>
      )}
      {!band && tapFeedback}
      {audioOnly && status.s === 'ready' && (
        <View pointerEvents="none" style={styles.center}><T mono size={12} color="rgba(255,255,255,0.7)">{tx('player.stageOverlays.audioOnly')}</T></View>
      )}
      {!band && status.s !== 'ready' && (
        <View pointerEvents="none" style={styles.loading}>
          <T mono size={12} color="#fff">{loadError ? `読み込めません: ${loadError}` : failed ? `再生できません: ${status.msg ?? ''}` : 'バッファリング中…'}</T>
        </View>
      )}
      {/* ロゴのタブを開いている間は、映像の上で範囲を囲む（操作の表示はこの上） */}
      {!band && logoRect && !failed && <LogoRectOverlay />}
      {!band && splitFrame && !playing && !failed && <SplitFrameOverlay dbRecId={splitFrame.dbRecId} t={splitFrame.t} node={splitFrame.node} />}
    </>
  );
}

const styles = StyleSheet.create({
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: '28%', backgroundColor: 'rgba(0,0,0,0.25)' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
