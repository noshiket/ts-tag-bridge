import type { MsgKey } from '@tstag/core';
// 見た目の土台。元の Web 版（legacy/web-jsx/src/helpers.jsx の THEMES / ACCENTS）と同じ値。
// 元は oklch() で書いてあるが React Native は読めないので、同じ色を sRGB の16進に直してある
// （sRGB に収まらない色は、ブラウザと同じく端で丸めた値）。

/** 枠と影の作風。offset: 太い枠 + ずらした影（元の Web 版）/ soft: 薄い枠 + ぼかした影 / flat: 薄い枠だけ */
export type Edge = 'offset' | 'soft' | 'flat';
/** 書体の作風（fonts.ts の FACES）。serif: 明朝 / round: 丸ゴシック */
export type FaceKey = 'serif' | 'round';

export interface Theme {
  name: string;
  /** 作風の短い説明（テーマの選択に出す） */
  note: MsgKey;
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  onInk: string;
  mute: string;
  line: string;
  /** 部品の枠の色（offset では ink と同じ）。ボタン・入力など押せる物の境目なので、面との明るさの比を 3 以上にする */
  frame: string;
  /** 一覧で繰り返すカードの枠（飾り。行を見比べる邪魔をしないよう弱めてよい） */
  cardFrame: string;
  edge: Edge;
  /** soft のぼかした影の色 */
  shade?: string;
  /** 色の付いた札の出し方（ui/parts/Mark）。fill: 塗る / quiet: 色の点と文字だけ */
  marks: 'fill' | 'quiet';
  /** 本文・見出し（12 以上の太字）の書体。無ければ端末の書体 */
  face?: { body?: FaceKey; heading?: FaceKey };
  isDark: boolean;
}

export interface Accent {
  name: string;
  primary: string;
  secondary: string;
  tertiary: string;
  quaternary: string;
}

export const THEMES = {
  pop: { name: 'Pop', note: 'ui.theme.boldFrames', bg: '#FFF7EA', surface: '#FFFFFF', surface2: '#FFE9D1', ink: '#1A1414', onInk: '#FFFFFF', mute: '#7A6E68', line: 'rgba(26,20,20,0.10)', frame: '#1A1414', cardFrame: '#1A1414', edge: 'offset', marks: 'fill', isDark: false },
  neon: { name: 'Neon Dark', note: 'ui.theme.boldFrames', bg: '#0E0B14', surface: '#18131F', surface2: '#231A2E', ink: '#F6F1FF', onInk: '#0E0B14', mute: 'rgba(246,241,255,0.55)', line: 'rgba(246,241,255,0.10)', frame: '#F6F1FF', cardFrame: '#F6F1FF', edge: 'offset', marks: 'fill', isDark: true },
  mono: { name: 'Mono Pop', note: 'ui.theme.boldFrames', bg: '#F0F0F0', surface: '#FFFFFF', surface2: '#E5E5E5', ink: '#0A0A0A', onInk: '#FFFFFF', mute: '#6B6B6B', line: 'rgba(10,10,10,0.10)', frame: '#0A0A0A', cardFrame: '#0A0A0A', edge: 'offset', marks: 'fill', isDark: false },
  // ここから下は作風ごと変えるテーマ（枠・影・書体）
  paper: { name: 'Paper', note: 'ui.theme.thinLinesSerif', bg: '#F4EFE6', surface: '#FBF8F2', surface2: '#ECE4D6', ink: '#23201B', onInk: '#FBF8F2', mute: '#6F675B', line: 'rgba(35,32,27,0.12)', frame: 'rgba(35,32,27,0.52)', cardFrame: 'rgba(35,32,27,0.22)', edge: 'flat', marks: 'quiet', face: { heading: 'serif' }, isDark: false },
  soft: { name: 'Soft', note: 'ui.theme.softRounded', bg: '#F3F1F8', surface: '#FFFFFF', surface2: '#E9E6F2', ink: '#2A2540', onInk: '#FFFFFF', mute: '#6E6984', line: 'rgba(42,37,64,0.10)', frame: 'rgba(42,37,64,0.52)', cardFrame: 'rgba(42,37,64,0.08)', edge: 'soft', marks: 'fill', shade: 'rgba(42,37,64,0.12)', face: { body: 'round', heading: 'round' }, isDark: false },
  cinema: { name: 'Cinema', note: 'ui.theme.darkSerif', bg: '#0B0B0C', surface: '#151517', surface2: '#1F1F22', ink: '#EDE8DF', onInk: '#0B0B0C', mute: 'rgba(237,232,223,0.55)', line: 'rgba(237,232,223,0.10)', frame: 'rgba(237,232,223,0.40)', cardFrame: 'rgba(237,232,223,0.16)', edge: 'flat', marks: 'quiet', face: { heading: 'serif' }, isDark: true },
} satisfies Record<string, Theme>;

// oklch(0.66 0.27 350)=#FE12A9 / (0.82 0.19 90)=#F4BC00 / (0.78 0.16 210)=#00D1EF /
// (0.82 0.20 135)=#88DF4B / (0.70 0.22 260)=#4297FF / (0.72 0.20 30)=#FF6853
export const ACCENTS = {
  magenta: { name: 'Magenta', primary: '#FE12A9', secondary: '#F4BC00', tertiary: '#00D1EF', quaternary: '#88DF4B' },
  electric: { name: 'Electric', primary: '#4297FF', secondary: '#F4BC00', tertiary: '#FE12A9', quaternary: '#88DF4B' },
  coral: { name: 'Coral', primary: '#FF6853', secondary: '#00D1EF', tertiary: '#88DF4B', quaternary: '#FE12A9' },
} satisfies Record<string, Accent>;

export type ThemeKey = keyof typeof THEMES;
export type AccentKey = keyof typeof ACCENTS;

/** 元の既定（helpers.jsx の TWEAK_DEFAULTS） */
export const DEFAULT_TWEAKS = { theme: 'pop' as ThemeKey, accent: 'coral' as AccentKey };

/** 警告・削除の赤。oklch(0.60 0.22 25) */
export const danger = '#E62B34';
/** エラー表示の箱。oklch(0.92 0.06 25) / (0.72 0.20 30) / (0.40 0.22 25) */
export const errorBox = { bg: '#FFD6D1', border: '#FF6853', text: '#9D0000' };

// 書体。元は本文 'Noto Sans JP'（英字も同じ）、ラベル類 'JetBrains Mono'。
// 本文は iOS では端末の日本語書体（ヒラギノ。太さが揃っている）、Web では元と同じ Noto Sans JP。
// ラベル類はアプリに JetBrains Mono を入れて使う（fonts.ts で読み込む）
export const monoFamily = {
  400: 'JetBrainsMono_400Regular',
  500: 'JetBrainsMono_500Medium',
  700: 'JetBrainsMono_700Bold',
  800: 'JetBrainsMono_800ExtraBold',
} as const;
export type MonoWeight = keyof typeof monoFamily;
