import { createContext } from 'react';
import { StyleSheet, type GestureResponderEvent } from 'react-native';

/** なぞる帯のルーペ（半径・倍率）と、押したかなぞったかの境目 */
export const LENS_R = 46;
export const LENS_ZOOM = 14;
export const DRAG_MIN_PX = 4;

/**
 * なぞる帯を触っている間、外の縦の ScrollView を止める（分割画面が渡す）。止めないと iOS では指が少し動いた所で
 * ScrollView が触りを奪い、ルーペが一瞬で消えて選べなかった（onResponderTerminationRequest では止められない）
 */
export const ScrollLock = createContext<(on: boolean) => void>(() => {});

/** 帯の上の位置（割合）。中の子は pointerEvents none にして、帯そのものの locationX で取る */
export const ratioOf = (e: GestureResponderEvent, w: number) => Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, w)));

/** 帯の部品で共通の見た目（ルーペの円・位置決め・小さい余白） */
export const stripStyles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  mt2: { marginTop: 2 },
  lens: { position: 'absolute', top: -LENS_R * 2 - 6, width: LENS_R * 2, height: LENS_R * 2, borderRadius: LENS_R, overflow: 'hidden', borderWidth: 2, zIndex: 6, boxShadow: '0px 3px 10px rgba(0,0,0,0.35)' },
});
