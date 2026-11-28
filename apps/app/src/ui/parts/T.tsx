import { Platform, Text, TextInput, type TextProps, type TextStyle } from 'react-native';

import { useTheme } from '../theme/Tweaks';
import { faceFamily } from '../theme/fonts';
import { monoFamily, type MonoWeight } from '../theme/theme';

// 文字。元の Web 版は本文が Noto Sans JP、ラベル類（件数・日付・英字の見出し）が JetBrains Mono。
//   <T size={14} w={800}>アルバム名</T>   <T mono size={9} dim>11本 · 最終 11/7</T>
type Weight = 400 | 500 | 700 | 800 | 900;

interface Props extends TextProps {
  size?: number;
  w?: Weight;
  mono?: boolean;
  /** 薄い文字（theme.mute） */
  dim?: boolean;
  color?: string;
  /**
   * 範囲を選んで写せる（Web のように長押しで選ぶ範囲を指定する）。iOS は読み取り専用の文章の箱（UITextView）で出す。
   * 箱は触った指を受け取るので、ボタン・押すカードの中では使わない（押しても反応しなくなる）。本文・詳細の値・題名などに使う。
   * 省略時の文字も長押しで「コピー」（固まりごと）はできる
   */
  range?: boolean;
}

const SANS_WEB = "'Noto Sans JP', 'Space Grotesk', system-ui, sans-serif";

export function T({ size = 12, w = 400, mono, dim, color, style, selectable = true, range, ...rest }: Props) {
  const { theme } = useTheme();
  // 等幅の書体に日本語の字形は無く、端末の日本語書体で出る。Web は太さを付けないと
  // その日本語が細いままになる（元の Web 版は太く出ている）ので、太さも渡す
  // 本文はテーマの作風の書体があればそれ（明朝・丸ゴシック。fonts.ts）
  const face = mono ? null : faceFamily(theme, size, w);
  const font: TextStyle = mono
    ? { fontFamily: monoFamily[w as MonoWeight], ...(Platform.OS === 'web' && w >= 700 ? { fontWeight: String(w) as TextStyle['fontWeight'] } : null) }
    : { fontWeight: String(w) as TextStyle['fontWeight'], ...(face ? { fontFamily: face } : Platform.OS === 'web' ? { fontFamily: SANS_WEB } : null) };
  // 文字は選んで写せるのを既定にする（元の Web 版と同じ。iOS は長押しで「コピー」）。選ばせたくない所だけ selectable={false}
  const textStyle = [{ fontSize: size, color: color ?? (dim ? theme.mute : theme.ink) }, font, style];
  if (range && Platform.OS !== 'web') {
    // 中の文字の色・太さ（入れ子の T）はそのまま。箱の余白は消して普通の文字と同じ大きさにする
    return (
      <TextInput editable={false} multiline scrollEnabled={false} contextMenuHidden={false}
        style={[textStyle, styles.box] as never}>
        {rest.children}
      </TextInput>
    );
  }
  return <Text {...rest} selectable={selectable} style={textStyle} />;
}

const styles = { box: { padding: 0, paddingTop: 0, paddingBottom: 0, margin: 0, textAlignVertical: 'top' as const } };
