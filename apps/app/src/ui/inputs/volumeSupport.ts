// スマホ・タブレットの Web ブラウザは video.volume を実再生で効かせられないため、
// 音量スライダーを出さない。UA でモバイルを判定する（iPadOS は Mac UA を騙るので touch で補う）。
let cached: boolean | null = null;
export function canControlVolume(): boolean {
  if (cached != null) return cached;
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const ua = (nav && nav.userAgent) || '';
  const touch = nav ? (nav.maxTouchPoints ?? 0) : 0;
  const isIPadOS = /Macintosh/.test(ua) && touch > 1;
  const isMobile = /iPhone|iPod|Android|Mobile/i.test(ua) || isIPadOS;
  cached = !isMobile; // モバイルでなければ(=PC Web)制御可
  return cached;
}
