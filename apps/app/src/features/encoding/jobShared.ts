import { oklch } from '../../ui/theme/oklch';

/** エンコード進捗で使う色と小さな関数 */
export const JOB_RED = oklch(0.6, 0.22, 25);
export const JOB_GREEN = oklch(0.6, 0.2, 145);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
