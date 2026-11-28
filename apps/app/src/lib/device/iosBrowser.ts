// iPhone・iPad の Safari（Web 版）か。アプリ（iOS）とは別（アプリは Platform.OS で分かる）。
// iPad の Safari は Mac と名乗るので、触れる画面かどうかで見分ける
import { Platform } from 'react-native';

export const isIOSBrowser = Platform.OS === 'web' && typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
