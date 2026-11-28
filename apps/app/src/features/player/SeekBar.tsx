import { formatDuration, thumbnailCell, type SyncTrack, type ThumbnailTile } from '@tstag/core';
import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { T } from '../../ui/parts/T';
import { trackX } from '../../ui/gestures/trackX';
import { noPan } from '../../ui/gestures/noPan';

const GREEN = '#10b981';
/** サムネの幅（元と同じ） */
const PREVIEW_W = 160;

/** シークバーのサムネの画像（コマを格子に並べた1枚）。reflowed: iOS 向けに列を詰め直した画像 */
export interface SeekThumbnail {
  source: { uri: string; headers?: Record<string, string> };
  tile: ThumbnailTile;
  reflowed: boolean;
}

/** シークバー（元の Web 版と同じ: 緑の再生済み・白い読み込み済み・つまみ）。押す・なぞるで動かす */
export function SeekBar({ current, duration, buffered, chapters = [], drops = [], scramble = [], sync = [], thumbnail, onSeek, onScrub, extra, waveform }: {
  current: number;
  duration: number;
  buffered: number;
  /** チャプターの頭（秒）。バーの下に ▲ を出す */
  chapters?: number[];
  /** ドロップの位置（秒）。赤い縦線（元と同じ） */
  drops?: number[];
  /** スクランブルの区間。橙の帯（元と同じ） */
  scramble?: { start: number; end: number }[];
  /**
   * 字幕・実況の取り込み区間（取り込み元ごと）。バーの上に1段ずつ積む。色の付いた所が取り込めた範囲で、
   * 切れ目が音が合わずに落ちた穴（元と同じく、コメントタブを開いている時だけ渡す）
   */
  sync?: SyncTrack[];
  /** なぞっている間、その時刻のコマを出す（無ければ時刻だけ） */
  thumbnail?: SeekThumbnail | null;
  onSeek: (seconds: number) => void;
  /** なぞっている間（離すまで操作の表示を消さない） */
  onScrub?: (active: boolean) => void;
  /** バーに重ねるもの（分割の切れ目など）。バーの幅を渡す */
  extra?: (barWidth: number) => ReactNode;
  /** 音楽の波形（元と同じく、バーを細くして波形を敷き、再生済みの側を緑にする） */
  waveform?: Uint8Array | null;
}) {
  const width = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) =>
    duration > 0 && width.current > 0 ? Math.max(0, Math.min(duration, (trackX(e, width.current) / width.current) * duration)) : 0;
  const shown = drag ?? current;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const peaks = waveform ? Array.from(waveform).filter((_, i) => i % 2 === 0) : null;
  return (
    <View
      style={[styles.bar, noPan, peaks && styles.musicBar]}
      onLayout={(e: LayoutChangeEvent) => { width.current = e.nativeEvent.layout.width; }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => { onScrub?.(true); setDrag(at(e)); }}
      onResponderMove={(e) => setDrag(at(e))}
      onResponderRelease={(e) => { onSeek(at(e)); setDrag(null); onScrub?.(false); }}
      onResponderTerminate={() => { setDrag(null); onScrub?.(false); }}
    >
      <View style={[styles.track, peaks && styles.musicTrack]} pointerEvents="none">
        <View style={[styles.buf, { width: `${bufPct}%` }]} />
        {!peaks && <View style={[styles.fill, { width: `${pct}%` }]} />}
      </View>
      {peaks && (
        <View pointerEvents="none" style={styles.wave}>
          {peaks.map((pk, i) => (
            <View key={i} style={[styles.peak, {
              height: `${Math.max(10, (pk / 255) * 100)}%`,
              backgroundColor: (i / peaks.length) * 100 <= pct ? GREEN : 'rgba(255,255,255,0.35)',
            }]} />
          ))}
        </View>
      )}
      {duration > 0 && scramble.map((r, i) => (
        <View key={`sc${i}`} pointerEvents="none" style={[styles.scramble, {
          left: `${(r.start / duration) * 100}%`, width: `${Math.max(0.4, ((r.end - r.start) / duration) * 100)}%` }]} />
      ))}
      {duration > 0 && drops.map((t, i) => (
        <View key={`dp${i}`} pointerEvents="none" style={[styles.drop, { left: `${(t / duration) * 100}%` }]} />
      ))}
      {duration > 0 && sync.map((sy, si) => (
        <View key={`sy${si}`} pointerEvents="none" style={[styles.syncRow, { top: -6 - si * 5 }]}>
          {sy.ranges.map((r, ri) => (
            <View key={ri} style={[styles.syncRange, { backgroundColor: SYNC_COLORS[si % SYNC_COLORS.length],
              left: `${(r.start / duration) * 100}%`, width: `${Math.max(0.3, ((r.end - r.start) / duration) * 100)}%` }]} />
          ))}
        </View>
      ))}
      {duration > 0 && chapters.filter((c) => c > 0).map((c, i) => (
        <View key={i} pointerEvents="none" style={[styles.chapter, { left: `${(c / duration) * 100}%` }]} />
      ))}
      {extra?.(width.current)}
      <View pointerEvents="none" style={[styles.knob, { left: `${pct}%` }]} />
      {drag != null && thumbnail && (
        <Preview thumbnail={thumbnail} time={drag} left={Math.max(0, (pct / 100) * width.current - PREVIEW_W / 2)} />
      )}
      {drag != null && !thumbnail && (
        <View pointerEvents="none" style={[styles.tip, { left: `${pct}%` }]}>
          <T mono size={11} color="#fff">{formatDuration(drag)}</T>
        </View>
      )}
    </View>
  );
}

function Preview({ thumbnail: { source, tile, reflowed }, time, left }: { thumbnail: SeekThumbnail; time: number; left: number }) {
  const cell = thumbnailCell(tile, time, reflowed);
  // 縦長の動画のコマは高さを PREVIEW_W に収める（横長は幅を PREVIEW_W に）
  const scale = PREVIEW_W / Math.max(tile.tile_width, tile.tile_height);
  return (
    <View pointerEvents="none" style={[styles.preview, { left: left + (PREVIEW_W - tile.tile_width * scale) / 2, width: tile.tile_width * scale + 4, height: tile.tile_height * scale + 4 }]}>
      <Image source={source} cachePolicy="memory-disk"
        style={{ position: 'absolute', left: -cell.x * scale, top: -cell.y * scale, width: cell.imageWidth * scale, height: cell.imageHeight * scale }} />
      <T mono size={10} color="#fff" style={styles.previewTime}>{formatDuration(time) || '0:00'}</T>
    </View>
  );
}

/** 取り込み区間の色（取り込み元ごと。元と同じ） */
const SYNC_COLORS = ['rgba(56,189,248,0.85)', 'rgba(167,139,250,0.85)', 'rgba(52,211,153,0.85)'];

const styles = StyleSheet.create({
  bar: { height: 14, justifyContent: 'center' },
  scramble: { position: 'absolute', top: 2, bottom: 2, backgroundColor: 'rgba(245,158,11,0.85)', borderRadius: 2 },
  drop: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: '#ef4444' },
  syncRow: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.10)' },
  syncRange: { position: 'absolute', top: 0, height: 3, borderRadius: 2 },
  musicBar: { height: 40 },
  musicTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  wave: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 1 },
  peak: { flex: 1, borderRadius: 1 },
  track: { height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  buf: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.4)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: GREEN },
  knob: {
    position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: GREEN,
    boxShadow: '0px 0px 0px 2px rgba(0,0,0,0.4)',
  },
  // 元は CSS の三角（幅 8・高さ 7 の白）
  chapter: {
    position: 'absolute', bottom: 0, marginLeft: -4, width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: 'rgba(255,255,255,0.85)',
  },
  preview: {
    position: 'absolute', bottom: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 6,
    overflow: 'hidden', backgroundColor: '#000',
  },
  previewTime: {
    position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  tip: { position: 'absolute', bottom: 22, marginLeft: -24, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.8)' },
});
