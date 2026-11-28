import { trackTitle, type Track } from '@tstag/core';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Sleeve } from './Sleeve';
import type { MusicLibrary } from '../useMusicLibrary';
import { RepeatButton } from '../musicControls';
import { Cover } from '../musicParts';
import { Shuffle } from '../../../../ui/parts/Icons';
import { Num } from '../../../../ui/parts/Num';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 「最近の再生」をレコード棚で: いちばん上に最後に聴いた 1 枚を大きく（再生・シャッフル・繰り返し）、
 * その他の最近は棚に横へ並べ、よく聴く曲は回数を数字で。押すとその並びを積んで再生、長押しで曲の操作
 */
export function RecentShelf({ m, recent, top }: { m: MusicLibrary; recent: Track[]; top: Track[] }) {
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const last = recent[0];
  const menu = (v: Track) => m.setTrackMenu({ v });
  return (
    <>
      {last && (
        <View style={styles.hero}>
          <Pressable onPress={() => m.playList(recent, last.id)} onLongPress={() => menu(last)} style={styles.heroSleeve}>
            <Sleeve m={m} uri={m.api.music.coverUrl(last.id, m.node)} />
          </Pressable>
          <View style={styles.grow}>
            <T size={9} w={700} dim>{tx('library.music.lastListened')}</T>
            <T size={19} w={900} numberOfLines={2} style={styles.heroTitle}>{trackTitle(last)}</T>
            <T size={11} dim numberOfLines={1}>{last.album_name ?? ''}</T>
            <View style={styles.btns}>
              <Pressable onPress={() => m.playList(recent, last.id)} style={[styles.play, { backgroundColor: accent.primary }]}>
                <T size={11} w={800} color="#fff">{tx('library.music.play')}</T>
              </Pressable>
              <Pressable onPress={() => m.shuffle(recent)} accessibilityLabel={tx('library.music.shuffle')} style={[styles.round, { borderColor: theme.line }]}>
                <Shuffle c={theme.ink} />
              </Pressable>
              <RepeatButton m={m} />
            </View>
          </View>
        </View>
      )}
      {recent.length > 1 && (
        <>
          <T size={12} w={900} style={[styles.sec, { borderBottomColor: theme.line }]}>{tx('library.music.recent')}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {recent.slice(1).map((v) => (
              <Pressable key={v.id} onPress={() => m.playList(recent, v.id)} onLongPress={() => menu(v)} style={styles.shelfItem}>
                <Sleeve m={m} uri={m.api.music.coverUrl(v.id, m.node)} />
                <T size={11} w={800} numberOfLines={1} style={styles.mt6}>{trackTitle(v)}</T>
                <T size={9} dim numberOfLines={1}>{v.album_name ?? ''}</T>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      {top.length > 0 && (
        <>
          <T size={12} w={900} style={[styles.sec, { borderBottomColor: theme.line }]}>{tx('library.music.top')}</T>
          {top.map((v) => (
            <Pressable key={v.id} onPress={() => m.playList(top, v.id)} onLongPress={() => menu(v)} style={[styles.row, { borderBottomColor: theme.line }]}>
              <Cover m={m} uri={m.api.music.coverUrl(v.id, m.node)} size={40} radius={3} />
              <View style={styles.grow}>
                <T size={13} w={700} numberOfLines={1}>{trackTitle(v)}</T>
                <T size={10} dim numberOfLines={1}>{v.album_name ?? ''}</T>
              </View>
              <Num size={20} color={accent.primary}>{String(v.play_count ?? 0)}</Num>
              <T size={9} dim>{tx('library.music.times', { n: v.play_count ?? 0 })}</T>
            </Pressable>
          ))}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6, marginBottom: 18 },
  heroSleeve: { width: 160 },
  grow: { flex: 1, minWidth: 0 },
  heroTitle: { lineHeight: 23, marginVertical: 2 },
  btns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  play: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  round: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  sec: { borderBottomWidth: 1, paddingBottom: 4, marginBottom: 10, marginTop: 4 },
  shelf: { gap: 12, paddingBottom: 16 },
  shelfItem: { width: 100 },
  mt6: { marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1 },
});
