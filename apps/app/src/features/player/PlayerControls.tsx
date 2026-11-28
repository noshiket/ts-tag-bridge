import { tNow } from '../../ui/i18n/I18n';
import { formatDuration, qualityLabel, type Quality, type SyncTrack } from '@tstag/core';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Slider } from '../../ui/inputs/Slider';
import { canControlVolume } from '../../ui/inputs/volumeSupport';
import { T } from '../../ui/parts/T';
import { SeekBar, type SeekThumbnail } from './SeekBar';
import { useT } from '../../ui/i18n/I18n';

/**
 * 映像の上に重ねる操作（元の Web 版の上部・中央・下部のオーバーレイ）。
 * 上: ← 戻る / 題名 / vdb:番号 / 画質。中央: 再生/停止。下: シークバーと «10 10» 時刻 …
 */
export function PlayerControls(p: {
  visible: boolean;
  title: string;
  label: string;
  playing: boolean;
  current: number;
  duration: number;
  buffered: number;
  rate: number;
  hasSecondaryAudio: boolean;
  secondaryAudio: boolean;
  chapters: number[];
  /** シークバーのドロップ・スクランブル・取り込み区間（元と同じ印） */
  drops?: number[];
  scramble?: { start: number; end: number }[];
  sync?: SyncTrack[];
  thumbnail: SeekThumbnail | null;
  /** シークバーに重ねるもの（分割タブの切れ目） */
  seekExtra?: (barWidth: number) => ReactNode;
  /** 音楽の波形（シークバーに敷く） */
  waveform?: Uint8Array | null;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSkip: (sec: number) => void;
  onSeek: (sec: number) => void;
  onScrub: (active: boolean) => void;
  onResetRate: () => void;
  onToggleAudio: () => void;
  commentsOn: boolean;
  onToggleComments: () => void;
  hasCaption: boolean;
  captionOn: boolean;
  onToggleCaption: () => void;
  onPip: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** 横画面（⟳。undefined なら出さない＝PC の幅） */
  rotated?: boolean;
  onRotate: () => void;
  /** 右のパネルの開閉（PC の幅の時だけ。undefined なら ▤ を出さない） */
  panelOpen?: boolean;
  onTogglePanel: () => void;
  onMore: () => void;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  /** なぞり終えた時（ここで保存する） */
  onVolumeDone: (v: number) => void;
  onToggleMute: () => void;
}) {
  const { t: tx } = useT();
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: p.visible ? 1 : 0 }]} pointerEvents={p.visible ? 'box-none' : 'none'}>
      <LinearGradient colors={['rgba(0,0,0,0.7)', 'transparent']} style={styles.top}>
        <Pressable onPress={p.onBack} style={styles.back}><T mono size={12} color="#fff">{tx('common.back2')}</T></Pressable>
        <T size={14} w={500} color="#fff" numberOfLines={1} style={styles.title}>{p.title}</T>
        <T mono size={11} color="rgba(255,255,255,0.7)">{p.label}</T>
      </LinearGradient>

      <View style={styles.center} pointerEvents="box-none">
        {/* チャプター送りはチャプターがある時だけ（元と同じ） */}
        {p.chapters.length > 0 && (
          <Pressable onPress={p.onPrevChapter} style={styles.chap} accessibilityLabel={tx('player.playerControls.previousChapter')}>
            <T size={16} w={700} color="#fff">|◁</T>
          </Pressable>
        )}
        <Pressable onPress={p.onTogglePlay} style={styles.play} accessibilityLabel={p.playing ? tx('recresult.encode.pause') : tx('library.video.playA11y')}>
          {p.playing ? <PauseIcon /> : <PlayIcon />}
        </Pressable>
        {p.chapters.length > 0 && (
          <Pressable onPress={p.onNextChapter} style={styles.chap} accessibilityLabel={tx('player.playerControls.nextChapter')}>
            <T size={16} w={700} color="#fff">▷|</T>
          </Pressable>
        )}
      </View>

      {/* iOS のグラデーションははみ出しを切る（masksToBounds）。シークバーのサムネが上へはみ出すので、グラデーションは敷くだけにする */}
      <View style={styles.bottom} pointerEvents="box-none">
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <SeekBar current={p.current} duration={p.duration} buffered={p.buffered} chapters={p.chapters} drops={p.drops} scramble={p.scramble} sync={p.sync} thumbnail={p.thumbnail} onSeek={p.onSeek} onScrub={p.onScrub} extra={p.seekExtra} waveform={p.waveform} />
        <View style={styles.row}>
          <Btn onPress={() => p.onSkip(-10)}>«10</Btn>
          <Btn onPress={() => p.onSkip(10)}>10»</Btn>
          <T mono size={11} color="rgba(255,255,255,0.85)">{`${formatDuration(p.current) || '0:00'} / ${formatDuration(p.duration) || '0:00'}`}</T>
          {/* 等倍以外のときだけ速度を出す（変更中と分かるように） */}
          {p.rate !== 1 && <Btn onPress={p.onResetRate}>{`${p.rate}×`}</Btn>}
          <Btn active={p.commentsOn} onPress={p.onToggleComments}>{tx('common.c')}</Btn>
          {p.hasCaption && <Btn active={p.captionOn} onPress={p.onToggleCaption}>{tx('library.video.cc')}</Btn>}
          <View style={styles.grow} />
          <Btn label={tx('common.miniPlayer')} onPress={p.onPip}><PipIcon /></Btn>
          <Btn label={tx('common.fullscreen')} active={p.fullscreen} onPress={p.onToggleFullscreen}><FullscreenIcon color={p.fullscreen ? '#000' : '#fff'} /></Btn>
          {p.rotated !== undefined && <Btn label={tx('common.landscape')} active={p.rotated} onPress={p.onRotate}><RotateIcon color={p.rotated ? '#000' : '#fff'} /></Btn>}
          {p.panelOpen !== undefined && <Btn label={tx('player.playerControls.panel')} active={p.panelOpen} onPress={p.onTogglePanel}>▤</Btn>}
          {p.hasSecondaryAudio && <Btn active={p.secondaryAudio} onPress={p.onToggleAudio}>{p.secondaryAudio ? tx('library.video.sap') : tx('common.main')}</Btn>}
          <Btn onPress={p.onMore}>…</Btn>
          <Pressable onPress={p.onToggleMute} accessibilityLabel={p.muted ? tx('player.playerControls.unmute') : tx('player.playerControls.mute')} style={styles.mute}>
            {p.muted ? <MuteIcon /> : <VolumeIcon />}
          </Pressable>
          {canControlVolume() && (<Slider label={tx('common.volume')} width={80} value={p.muted ? 0 : p.volume} onChange={p.onVolume} onDone={p.onVolumeDone} />)}
        </View>
      </View>
    </View>
  );
}

/** 画質の表示（vdb:23324 / 720p） */
export const playerLabel = (videoId: number, quality: Quality, direct: boolean, rec = false) =>
  `${rec ? 'rec' : 'vdb'}:${videoId} / ${direct ? tNow('player.controls.original') : qualityLabel(quality)}`;

function Btn({ children, onPress, active, label }: { children: ReactNode; onPress: () => void; active?: boolean; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={[styles.btn, { backgroundColor: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)' }]}>
      <T mono size={13} color={active ? '#000' : '#fff'}>{children}</T>
    </Pressable>
  );
}

/** PiP（小窓）。文字の ⧉ は書体に無く空白になるので線で描く */
export const PipIcon = ({ color = '#fff' }: { color?: string }) => (
  <Svg width={14} height={14} viewBox="0 0 16 16">
    <Path d="M1.5 3h13v10h-13z" stroke={color} strokeWidth={1.4} fill="none" />
    <Path d="M8.5 8.5h5v3.5h-5z" fill={color} />
  </Svg>
);

/** 全画面（元の ⛶。PiP と同じく線で描く） */
export const FullscreenIcon = ({ color }: { color: string }) => (
  <Svg width={14} height={14} viewBox="0 0 16 16">
    <Path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" stroke={color} strokeWidth={1.6} fill="none" />
  </Svg>
);

/** 横画面（元の ⟳。書体に無いことがあるので線で描く） */
export const RotateIcon = ({ color }: { color: string }) => (
  <Svg width={14} height={14} viewBox="0 0 16 16">
    <Path d="M13.2 8.6A5.3 5.3 0 1 1 11.6 4" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    <Path d="M9.2 1.6l3.6 1.9-1.6 3.6z" fill={color} />
  </Svg>
);

/** 音量・消音（元の I.Volume / I.Mute） */
const VolumeIcon = () => (
  <Svg width={17} height={17} viewBox="0 0 16 16">
    <Path d="M2 6h2.6L8 3.2v9.6L4.6 10H2z" fill="#fff" />
    <Path d="M10.2 5.2a4 4 0 0 1 0 5.6M12 3.4a6.5 6.5 0 0 1 0 9.2" stroke="#fff" strokeWidth={1.4} fill="none" strokeLinecap="round" />
  </Svg>
);
const MuteIcon = () => (
  <Svg width={17} height={17} viewBox="0 0 16 16">
    <Path d="M2 6h2.6L8 3.2v9.6L4.6 10H2z" fill="#fff" />
    <Path d="M10.3 6.3l4 4M14.3 6.3l-4 4" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const PlayIcon = () => (
  <Svg width={32} height={32} viewBox="0 0 16 16"><Path d="M4 3l9 5-9 5z" fill="#fff" /></Svg>
);
const PauseIcon = () => (
  <Svg width={32} height={32} viewBox="0 0 16 16"><Path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="#fff" /></Svg>
);

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  back: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(0,0,0,0.3)' },
  title: { flex: 1 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  chap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  play: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 8, paddingTop: 18, paddingHorizontal: 14, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 },
  grow: { flex: 1 },
  mute: { padding: 2 },
  btn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
});
