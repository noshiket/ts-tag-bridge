// 設定の「ロゴ」（元の SettingsLogo）。サーバーが持っている局のロゴの一覧

/** GET /api/logo/list の1件（sizes が空なのは利用者が置いたロゴ） */
export interface LogoEntry { onid: number; sid: number; sizes: { w: number; h: number }[] }

/** 帯（地デジは 32736〜32742 だけ。それ以外の地デジ以外の番号は出さない。元と同じ） */
export function logoBand(onid: number): 'terr' | 'bs' | 'cs' | 'other' {
  if (onid >= 32736 && onid <= 32742) return 'terr';
  if (onid === 4) return 'bs';
  if (onid === 6 || onid === 7) return 'cs';
  return 'other';
}

/** いちばん大きいサイズで出す（サイズが無ければ 16:9 の 64x36） */
export const logoDisplaySize = (l: LogoEntry) =>
  l.sizes.length ? l.sizes.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b), l.sizes[0]!) : { w: 64, h: 36 };

export function groupLogos(logos: LogoEntry[]) {
  const g: Record<'terr' | 'bs' | 'cs', LogoEntry[]> = { terr: [], bs: [], cs: [] };
  for (const l of logos) { const b = logoBand(l.onid); if (b !== 'other') g[b].push(l); }
  return g;
}
