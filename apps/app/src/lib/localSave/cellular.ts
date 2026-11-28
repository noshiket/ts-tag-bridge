import { useSyncExternalStore } from 'react';

import { deviceStore } from '../device/deviceStore';

/**
 * 保存のダウンロードをモバイル通信でもするか（端末ごと。既定はする）。しない時は、モバイル通信の間は待ち、
 * Wi-Fi につながったら取る。iOS の部品（tstag-download）が入ったアプリだけ（Web・前のアプリでは選べない）
 */
const KEY = 'tstag_download_cellular';
let allow = deviceStore.get(KEY) !== '0';
const subs = new Set<() => void>();

export const cellularDownload = {
  available: () => false, // ネイティブのダウンロード（tstag-download）は Web に無い
  allowed: () => allow,
  set(v: boolean) {
    allow = v;
    deviceStore.set(KEY, v ? '1' : '0');
    subs.forEach((f) => f());
  },
};

export const useCellularDownload = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => allow);

/** Wi-Fi を待っているか（モバイル通信でしない指定で、今モバイル通信の時）。ネイティブのダウンロードが無い Web では起きない */
export function useWaitingForWifi(): boolean {
  return false;
}
