import type { StyleProp, ViewStyle } from 'react-native';

/** 映像を出す部品の約束。iOS は VideoSurface.ios.tsx（AVPlayer）、Web は VideoSurface.tsx（hls.js） */
export interface VideoSurfaceHandle {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** 今の位置（秒）。飛ばしている途中でも飛び先を返す（onTime は飛び終えるまで届かない） */
  now(): number;
  /** PiP（使えない端末では何もしない） */
  startPictureInPicture(): void;
  /** 今のコマを写す（キャプチャ用）。Web だけ（iOS は captureImage） */
  grabFrame(): Promise<GrabbedFrame | null>;
  /** iOS のキャプチャ: 今のコマに画面と同じ弾幕・字幕を重ねた JPEG（data URL）と再生位置。撮れなければ null */
  captureImage?(args: { danmaku: string | null; opacity: number; stageWidth: number; stageHeight: number; includeCaption: boolean }): Promise<{ image: string; time: number } | null>;
  /** 下のミニプレイヤーに同じ映像を出すためのプレイヤー（iOS だけ。expo-video の VideoPlayer） */
  nativePlayer?(): unknown;
  /** 音声トラック（端末保存した録画は 1 ファイルに主・副の入っていることがある）。id は availableAudioTracks の添字。Web は空 */
  audioTracks(): { id: number; label: string }[];
  /** 今鳴っているトラックの id。選んでいなければ null */
  currentAudioTrack(): number | null;
  /** トラックを選ぶ（id を超える値では何もしない） */
  selectAudioTrack(id: number): void;
}

/** 写したコマ: 映像の大きさの canvas と、写した時の再生位置（秒） */
export interface GrabbedFrame {
  canvas: HTMLCanvasElement;
  time: number;
}

export interface PlaybackTime {
  current: number;
  duration: number;
  buffered: number;
}

export interface VideoSurfaceProps {
  /** null の間は何も読まない */
  source: { uri: string; headers?: Record<string, string> } | null;
  /** 読み終えた時に一度だけ飛ぶ位置（秒）。続きから・画質を変えた時の位置 */
  startAt: number;
  muted: boolean;
  volume: number;
  rate: number;
  onTime: (t: PlaybackTime) => void;
  onPlayingChange: (playing: boolean) => void;
  onStatus: (status: 'loading' | 'ready' | 'error', message?: string) => void;
  onEnded: () => void;
  /** 映像の大きさ（px）が分かった・変わった時。全画面の向きを縦長か横長かで決めるのに使う */
  onVideoSize?: (size: { width: number; height: number }) => void;
  style?: StyleProp<ViewStyle>;
  /** 字幕・弾幕を焼き込んだ PiP に渡すもの（iOS だけ。部品が無いアプリ・Web では素の PiP） */
  pip?: PipOverlay;
  /**
   * 音だけで聴く（音楽・画質「音声のみ」）。小窓にせず、裏でも鳴らし続け、ロック画面・コントロールセンターに
   * 曲名と操作を出す（iOS だけ）。artwork は端末のファイル、artworkSource はサーバーの画像（端末へ落としてから渡す）
   */
  audioMode?: { title: string; artist?: string; artwork?: string; artworkSource?: { uri: string; headers?: Record<string, string> } } | null;
}

export interface PipOverlay {
  /** 再生画面が前に出ている間だけ構える（ホームに戻ると自動で小窓になる） */
  active: boolean;
  /** 字幕（{captions:[...]} の JSON）とコメント（{comments:[...]} の JSON）。サーバーの形のまま */
  captions: string | null;
  comments: string | null;
  captionsOn: boolean;
  commentsOn: boolean;
  /** 弾幕の文字の大きさ（映像の高さに対する比）と不透明度 */
  fontRatio: number;
  opacity: number;
  duration: number;
  /** 小窓が開いた・閉じた。restored: アプリに戻る操作で閉じた（✕ではない） */
  onChange?: (c: { active: boolean; restored?: boolean }) => void;
}
