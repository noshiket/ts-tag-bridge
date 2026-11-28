import { deviceStore } from '../device/deviceStore';

/** 音量・消音を端末に覚えるキー（再生画面とライブ画面で共通。元の Web 版と同じ名前） */
export const VOLUME_KEY = 'tstag_player_volume';
export const MUTED_KEY = 'tstag_player_muted';
/** 音量の既定値 */
export const DEFAULT_VOLUME = 0.8;

/** 音量を [0,1] に収める */
export const clampVolume = (v: number) => Math.min(1, Math.max(0, v));

/** 端末に保存された音量を [0,1] で読む（未設定・不正値は既定） */
export const loadVolume = () => {
  const v = parseFloat(deviceStore.get(VOLUME_KEY) ?? '');
  return Number.isFinite(v) ? clampVolume(v) : DEFAULT_VOLUME;
};
