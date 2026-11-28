// 再生画面の「ロゴ」タブ（元の stream_right_tab_logo.jsx）: 映像の上で囲んだ範囲を、Amatsukaze のロゴ解析へ渡す画素へ直す

/** 映像に対する割合（0〜1） */
export interface RelRect { x: number; y: number; w: number; h: number }
export interface PixelRect { x: number; y: number; width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 割合 → 元映像（TS）の画素。Amatsukaze は偶数の座標を好むので2の倍数へ丸める */
export function logoRectToPixels(rel: RelRect, vw: number, vh: number): PixelRect {
  const x = Math.round((rel.x * vw) / 2) * 2;
  const y = Math.round((rel.y * vh) / 2) * 2;
  const w = Math.round((rel.w * vw) / 2) * 2;
  const h = Math.round((rel.h * vh) / 2) * 2;
  return { x: clamp(x, 0, Math.max(0, vw - 2)), y: clamp(y, 0, Math.max(0, vh - 2)), width: clamp(w, 2, vw - x), height: clamp(h, 2, vh - y) };
}

/** ドラッグの2点 → 範囲 */
export function logoNormalize(a: { x: number; y: number }, b: { x: number; y: number }): RelRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

const MIN = 0.005;
/** タッチパッド: 左上（tl）か右下（br）の角だけを動かす。対角は動かさず、0〜1 の外へ出さず、潰れないようにする */
export function logoMoveCorner(r: RelRect, corner: 'tl' | 'br', dx: number, dy: number): RelRect {
  let { x, y, w, h } = r;
  if (corner === 'tl') {
    const nx = clamp(x + dx, 0, x + w - MIN);
    const ny = clamp(y + dy, 0, y + h - MIN);
    w += x - nx; h += y - ny; x = nx; y = ny;
  } else {
    w = clamp(w + dx, MIN, 1 - x);
    h = clamp(h + dy, MIN, 1 - y);
  }
  return { x, y, w, h };
}

/** パッドで始める時の範囲（左上寄り＝局ロゴが出やすい所） */
export const LOGO_DEFAULT_RECT: RelRect = { x: 0.03, y: 0.04, w: 0.18, h: 0.12 };

/** 四隅を掴んだか（掴んでいれば、動かさない対角を返す）。tol は割合での当たりの幅 */
export function logoCornerAnchor(r: RelRect | null, p: { x: number; y: number }, tol: { x: number; y: number }): { x: number; y: number } | null {
  if (!r) return null;
  const xs = [r.x, r.x + r.w];
  const ys = [r.y, r.y + r.h];
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
    if (Math.abs(p.x - xs[i]!) < tol.x && Math.abs(p.y - ys[k]!) < tol.y) return { x: xs[1 - i]!, y: ys[1 - k]! };
  }
  return null;
}

/**
 * 進み具合（%）。Amatsukaze の progress は pass1 で 1 を超えて伸びるので使えない。
 * 「要るコマをどれだけ集めたか」で出す（元と同じ）
 */
export const logoProgress = (numValid: number | undefined, wantFrames: number) => clamp(Math.round(((numValid || 0) * 100) / (wantFrames || 1000)), 0, 100);

/** 黒帯を除いた映像の矩形（枠の中に縦横比を保って収めた時） */
export function containRect(boxW: number, boxH: number, aspect: number) {
  if (!(boxW > 0 && boxH > 0 && aspect > 0)) return { left: 0, top: 0, width: boxW, height: boxH };
  const width = Math.min(boxW, boxH * aspect);
  const height = width / aspect;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}
