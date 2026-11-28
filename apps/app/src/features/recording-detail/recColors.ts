import { oklch } from '../../ui/theme/oklch';

/** 録画詳細の色（失敗・無事・キュー済み・保護・DB の状態） */
export const REC_RED = oklch(0.6, 0.22, 25);
export const REC_RED_INK = oklch(0.45, 0.22, 25);
export const REC_OK = oklch(0.55, 0.15, 135);
export const REC_QUEUED = oklch(0.55, 0.18, 280);
export const REC_PROTECT = oklch(0.78, 0.16, 210);
export const REC_STATE_COLOR: Record<string, string> = {
  error: oklch(0.65, 0.25, 25), non_file: oklch(0.6, 0.2, 40), scanning: oklch(0.6, 0.18, 240), waiting: oklch(0.6, 0.18, 70), queued: REC_QUEUED,
};
