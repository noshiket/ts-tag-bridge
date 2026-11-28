import { oklch } from '../../../ui/theme/oklch';

/** 分割の画面で使う色（隙間・外す所の赤、SKIP の緑と赤） */
export const splitColors = {
  red: oklch(0.65, 0.25, 25),
  redDark: oklch(0.45, 0.22, 25),
  /** 録画の再生画面の分割タブの赤（元の色） */
  tabRed: '#C2252C',
  skipOn: { bg: oklch(0.9, 0.05, 145), fg: oklch(0.35, 0.15, 145), border: oklch(0.55, 0.2, 145) },
  skipOff: { bg: oklch(0.93, 0.05, 25), fg: oklch(0.4, 0.2, 25), border: oklch(0.55, 0.2, 25) },
};
