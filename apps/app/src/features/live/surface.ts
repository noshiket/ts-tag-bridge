import type { LiveComment, LiveStatus } from '@tstag/core';
import type { StyleProp, ViewStyle } from 'react-native';

/** プレイヤーのページへの命令（livePageJs.ts の command と同じ形） */
export type LiveCommand =
  | { type: 'play' } | { type: 'pause' } | { type: 'restart' } | { type: 'pip' }
  | { type: 'volume'; volume: number; muted: boolean }
  | { type: 'caption'; on: boolean } | { type: 'comments'; on: boolean }
  | { type: 'audio'; track: 'main' | 'sub' }
  | { type: 'settings'; settings: Record<string, unknown> }
  | { type: 'send'; id: number; text: string }
  | { type: 'capture'; id: number; includeComment: boolean; includeCaption: boolean };

/** プレイヤーのページから届くもの */
export type LiveEvent =
  | { type: 'status'; status: LiveStatus }
  | { type: 'state'; paused: boolean; buffering: boolean; bufferSec: number; width: number; height: number }
  | { type: 'error'; message: string | null }
  | { type: 'comment'; comment: LiveComment; initial: boolean }
  | { type: 'notice'; message: string }
  | { type: 'commentSupported'; supported: boolean; notice?: string }
  | { type: 'sent'; id: number; ok: boolean; error?: string }
  | { type: 'captured'; id: number; ok: boolean; image?: string; error?: string }
  | { type: 'pip'; active: boolean }
  | { type: 'pipSupported'; supported: boolean };

export interface LiveSurfaceHandle {
  command(c: LiveCommand): void;
}

export interface LiveSurfaceProps {
  /** /api か /api/nodes/<node>（他のサーバーのチューナー） */
  apiBase: string;
  channelId: string;
  quality: string;
  /** 始めの状態（途中の切り替えは command で送る） */
  initial: { volume: number; muted: boolean; captionOn: boolean; commentsOn: boolean; audioTrack: 'main' | 'sub'; settings: Record<string, unknown> };
  onEvent: (e: LiveEvent) => void;
  style?: StyleProp<ViewStyle>;
}
