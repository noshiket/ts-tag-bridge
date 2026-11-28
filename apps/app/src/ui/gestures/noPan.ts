import { Platform, type ViewStyle } from 'react-native';

/**
 * なぞる操作を受ける要素に付ける（Web だけ）。スマホのブラウザは指が少し動くとページのスクロールに
 * 触りを取られ（touchcancel）、responder が終わってしまう。touch-action: none でブラウザに渡さない
 */
export const noPan: ViewStyle = Platform.OS === 'web' ? ({ touchAction: 'none' } as unknown as ViewStyle) : {};
