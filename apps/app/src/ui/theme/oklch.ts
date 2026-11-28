/**
 * oklch → #RRGGBB。元の Web 版は色相から色を作る所（リールのサムネなど）で oklch() を使うが、
 * React Native は oklch を読めないので、同じ色をここで作る
 */
export function oklch(L: number, C: number, h: number): string {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const hex = (x: number) => {
    const v = Math.max(0, Math.min(1, x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${rgb.map(hex).join('').toUpperCase()}`;
}

/**
 * CSS の色の文字列を React Native が読める形にする。アドオンなどサーバーから来る色は Web 版向けに
 * `oklch(0.68 0.16 170)` で書かれていることがあり、React Native（iOS も Web 版の描画も）はそれを読めず色が付かない
 */
export function cssColor(c: string): string {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i.exec(c.trim());
  if (!m) return c;
  return oklch(m[2] ? Number(m[1]) / 100 : Number(m[1]), Number(m[3]), Number(m[4]));
}
