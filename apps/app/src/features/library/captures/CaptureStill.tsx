import type { LibraryCapture } from '@tstag/core';
import { Image, type ImageSource } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { More } from '../../../ui/parts/Icons';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

/** 番組名から話数（#8・第8話）を取る。無ければ空 */
export function captureEpisode(title: string | null): string {
  const m = (title ?? '').match(/#\s*(\d+)|第\s*(\d+)\s*[話回]/);
  return m ? (m[1] ?? m[2]) : '';
}

/** 撮った場面の時刻（放送の時計）。同じ回で続けて撮ったものを見分けられるよう秒まで: M/D H:MM:SS */
function shotAt(tot: string | null): string {
  if (!tot) return '';
  const d = new Date(tot);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * キャプチャ 1 枚（絵が主役）。左上に話数、右下に撮った場面の時刻、右上の … で操作のシート。
 * 押すとその位置から再生（位置が無ければ原寸）、長押しでも操作のシート
 */
export function CaptureStill({ c, source, width, onPress, onMenu }: {
  c: LibraryCapture;
  source: ImageSource;
  width: number;
  onPress: () => void;
  onMenu: () => void;
}) {
  const { t: tx } = useT();
  const ep = captureEpisode(c.eit_title);
  const at = shotAt(c.tot);
  return (
    <Pressable onPress={onPress} onLongPress={onMenu} accessibilityLabel={c.eit_title ?? c.file} style={[styles.still, { width }]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      {!!ep && <View style={styles.ep}><T size={9} w={800} color="#fff" style={GOTHIC}>#</T><Num size={15} color="#fff">{ep}</Num></View>}
      {!!at && <View style={styles.at}><Num size={11} color="#fff">{at}</Num></View>}
      <Pressable onPress={onMenu} hitSlop={8} accessibilityLabel={tx('common.menu')} style={styles.more}><More s={14} c="#fff" /></Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  still: { aspectRatio: 16 / 9, borderRadius: 6, overflow: 'hidden', backgroundColor: '#000' },
  ep: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'baseline', gap: 1, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 6, paddingVertical: 1, borderBottomRightRadius: 6 },
  at: { position: 'absolute', right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 6, paddingVertical: 2, borderTopLeftRadius: 6 },
  more: { position: 'absolute', right: 4, top: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
