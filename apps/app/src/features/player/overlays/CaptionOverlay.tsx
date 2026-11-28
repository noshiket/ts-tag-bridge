import { buildScreenGroups, captionSvg, type CaptionEntry } from '@tstag/core';
import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { parse, SvgAst, type XmlAST } from 'react-native-svg';

/**
 * 録画の字幕（ARIB）を映像に重ねる（元の「字」）。字幕の絵は元と同じ aribb24.js で作り、
 * SVG で描く（iOS・Web とも同じ）。画面全体の座標なので、映像と同じ枠に伸ばすと位置が合う
 */
export function CaptionOverlay({ captions, time }: { captions: CaptionEntry[]; time: number }) {
  const groups = useMemo(() => buildScreenGroups(captions), [captions]);
  const cache = useRef(new Map<string, string | null>());
  const raw = useMemo(() => captionSvg(groups, time, cache.current), [groups, time]);
  const svg = useMemo(() => (raw && Platform.OS !== 'web' ? forNativeSvg(raw) : raw), [raw]);
  const ast = useMemo(() => {
    try { return svg ? parse(svg, decodeTexts) : null; } catch { return null; }
  }, [svg]);
  if (!ast) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* 字幕が替わるたびに作り直す。iOS の SVG は前の字幕の要素を使い回し、新しい字幕に無い指定（半角の横の縮めなど）を
          消さずに残すため、次の字幕の文字が縮んだりずれたりした */}
      <SvgAst key={svg} ast={ast} override={{ width: '100%', height: '100%' }} />
    </View>
  );
}

/**
 * SVG の部品（react-native-svg）の読み取りは文字の中の &lt; などを元の文字に戻さず、字幕に「&lt;」がそのまま出ていた
 * （「<」「&」を含む字幕）。読み取った後の文字を元に戻す（iOS・Web とも）
 */
// captionSvg（core の serialize）が書くのはこの4つだけ
const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };
const decodeEntities = (s: string) => s.replace(/&(lt|gt|amp|quot);/g, (_m, e: string) => ENTITY[e]!);
function decodeTexts(n: XmlAST): XmlAST {
  n.children = n.children.map((c) => (typeof c === 'string' ? decodeEntities(c) : decodeTexts(c)));
  return n;
}

/**
 * aribb24.js の字幕の SVG を、iOS の SVG（react-native-svg）でも元（ブラウザ・元の Web 版の canvas）と同じに描けるよう書き換える。
 * iOS の SVG は次を無視するため、字幕の位置・大きさ・ルビの位置・縁取りがずれていた
 * - 入れ子の <svg x y width height viewBox>（字幕の面の位置）→ 移動と拡大の <g> にする
 * - transform-origin（ルビなど縦横に縮めた文字の基準点）→ 変形をやめ、文字の大きさ・縁の太さをその大きさで指定する
 * - textLength（元の canvas では幅の上限）→ 外し、字形が枠より広い文字だけ横に縮める変形にする
 * - paint-order="stroke"（縁取りを先に描き、塗りを上に重ねる）→ 縁取りだけの文字と塗りだけの文字に分けて重ねる
 * - 'Hiragino Maru Gothic Pro'（iOS では ProN という名前）→ iOS の丸ゴシックを名前で指定する
 * - dominant-baseline="central"（文字を y の高さの中央に置く）→ 同じ意味の alignment-baseline にする
 */
const NUM = String.raw`(-?[\d.]+)`;
/** 半角の文字（英数字・記号、半角カナ・｡｢｣など）。body は SVG の中の文字なので &lt; などを戻してから見る */
const isHalfWidth = (body: string) => /^[\u0020-\u007e\uff61-\uff9f\uffe8-\uffee]*$/.test(decodeEntities(body));
/**
 * 半角の英数字・記号の字形の幅（文字の大きさに対する比のおおよそ）。丸ゴシックの英字は字ごとに幅が違い、
 * 大文字や数字は半角の枠（大きさの半分）より広い。元（canvas）は枠より広い文字を枠の幅に縮めるが、
 * iOS では縮めずに描いて隣の字に重なっていた（「EDVA」など）。測れないので、この幅で縮める比を決める
 */
function halfGlyphWidth(body: string): number {
  let w = 0;
  for (const ch of decodeEntities(body)) {
    if (/[\uff61-\uff9f\uffe8-\uffee]/.test(ch)) w += 0.5; // 半角カナなどは枠ちょうどの幅
    else if (/[MW]/.test(ch)) w += 0.86;
    else if (/[IJ]/.test(ch)) w += 0.36;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[mw]/.test(ch)) w += 0.82;
    else if (/[ijl]/.test(ch)) w += 0.26;
    else if (/[frt]/.test(ch)) w += 0.4;
    else if (/[a-z]/.test(ch)) w += 0.57;
    else if (/\d/.test(ch)) w += 0.58;
    else if (/[#$%&?@<>=+~^_*]/.test(ch)) w += 0.62;
    else w += 0.32; // .,:;!|'"()[] などの細い記号は枠に収まる
  }
  return w;
}
export function forNativeSvg(svg: string): string {
  let out = svg.replace(
    new RegExp(String.raw`<svg viewBox="0 0 ${NUM} ${NUM}" x="${NUM}" y="${NUM}" width="${NUM}" height="${NUM}">`, 'g'),
    (_m, vw: string, vh: string, x: string, y: string, w: string, h: string) =>
      `<g transform="translate(${x} ${y}) scale(${Number(w) / Number(vw)} ${Number(h) / Number(vh)})">`,
  );
  // 外側の </svg> は残し、内側（今は <g>）の閉じだけを </g> にする
  const inner = (out.match(/<g transform="translate\(/g) ?? []).length;
  for (let k = 0; k < inner; k++) {
    const last = out.lastIndexOf('</svg>');
    const prev = out.lastIndexOf('</svg>', last - 1);
    if (prev < 0) break;
    out = `${out.slice(0, prev)}</g>${out.slice(prev + 6)}`;
  }
  // 縮めた文字（ルビなど）は、描いてから縮めるのではなく、初めからその大きさで描く。
  // 縮める変形のままだと縁取りが縮まず太く潰れ、元（canvas）の小さく細い縁のルビと違って見えた。
  // 文字の幅（textLength）は、元の canvas では「これより広ければ縮める」上限（fillText の maxWidth）だが、
  // iOS の SVG は文字そのものを引き伸ばしてその幅にするため、文字が横に太って見えた。普通の幅の文字では外し、
  // 字形が枠より広い文字だけ、その比で横に縮める（全角の字形は文字の大きさと同じ幅。半角は halfGlyphWidth のおおよその幅）
  out = out.replace(/<text ([^>]*)>([^<]*)<\/text>/g, (_m, attrs: string, body: string) => {
    const num = (name: string) => { const m = new RegExp(`\\b${name}="${NUM}"`).exec(attrs); return m ? Number(m[1]) : null; };
    const t = new RegExp(String.raw`transform="scale\(${NUM} ${NUM}\)" transform-origin="${NUM} ${NUM}"`).exec(attrs);
    const sx = t ? Number(t[1]) : 1, sy = t ? Number(t[2]) : 1;
    const fs = (num('font-size') ?? 0) * sy;
    const tl = (num('textLength') ?? fs) * sx;
    const x = num('x') ?? 0, y = num('y') ?? 0;
    let a = (t ? attrs.replace(t[0], '') : attrs)
      .replace(/\btextLength="[^"]*"/, '').replace(/\blengthAdjust="[^"]*"/, '');
    a = a.replace(new RegExp(`\\bfont-size="${NUM}"`), `font-size="${fs}"`);
    a = a.replace(new RegExp(`\\bstroke-width="${NUM}"`), (_x, v: string) => `stroke-width="${Number(v) * sy}"`);
    const glyph = fs * (isHalfWidth(body) ? halfGlyphWidth(body) : 1);
    if (tl < glyph - 0.5) a += ` transform="translate(${x} ${y}) scale(${tl / glyph} 1) translate(${-x} ${-y})"`;
    return `<text ${a}>${body}</text>`;
  });
  out = out.replace(/font-family="[^"]*Hiragino Maru Gothic[^"]*"/g, 'font-family="HiraMaruProN-W4"');
  out = out.replace(/dominant-baseline="central"/g, 'alignment-baseline="central"');
  return out.replace(/<text ([^>]*?)paint-order="stroke"([^>]*)>([^<]*)<\/text>/g, (_m, a: string, b: string, body: string) => {
    const attrs = `${a}${b}`;
    const strokeOnly = attrs.replace(/\bfill="[^"]*"/, 'fill="none"');
    const fillOnly = attrs.replace(/\bstroke="[^"]*"/, 'stroke="none"');
    return `<text ${strokeOnly}>${body}</text><text ${fillOnly}>${body}</text>`;
  });
}
