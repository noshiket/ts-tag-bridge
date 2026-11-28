import { usePrefs } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { isMiniFull, miniBarHeight, miniFullVideoWidth, miniPlayer, miniRowThumb, useMiniPlayer } from '../../lib/playback/miniPlayer';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { openPlayer } from './PlayerHost';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';
import { useAppActive } from '../../lib/lifecycle/appActive';
import { useBandMeasure } from './useBandMeasure';
import { VerticalTitle } from './VerticalTitle';
import { useT } from '../../ui/i18n/I18n';

const GAP = 32;
const fmt = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
};

/**
 * ミニプレイヤー（元の shared.jsx の MiniPlayerBar）。再生画面を離れても鳴っているものを出し、
 * サムネ・題名で戻る・再生/停止・次の話数へ・終了ができる。タブの上に出す
 */
export function MiniPlayerBar() {
  const { t: tx } = useT();
  useBgRenderCount('MiniBar');
  const { theme, accent } = useTheme();
  const { mini: st, session, time: t, pip } = useMiniPlayer();
  const prefs = usePrefs();
  const setting = (prefs.data?.app_settings as { mini_player_height?: number } | undefined)?.mini_player_height;
  // 横幅いっぱい: 映像を帯の幅で 16:9 に出し、題名とボタンはその下に並べる
  const full = isMiniFull(setting);
  const [boxW, setBoxW] = useState(0);
  const barH = miniBarHeight(setting);
  const row = miniRowThumb(barH, boxW);
  const thumbW = full ? miniFullVideoWidth(boxW - 20) : row.w;
  const thumbH = full ? Math.round((thumbW * 9) / 16) : row.h;
  const [thumbErr, setThumbErr] = useState(false);
  const band = useBandMeasure();
  useEffect(() => setThumbErr(false), [st?.thumb?.uri]);
  // 小窓（PiP）で見ている間は帯を出さない
  if (!st || !session || pip) return null;
  const label = [st.title, st.episodeNum ? `#${st.episodeNum}` : '', st.episodeName].filter(Boolean).join('  ') || tx('shell.miniPlayerBar.playing');
  const open = () => openPlayer(session);
  const btn = (text: string, onPress: () => void, title: string, primary = false) => (
    <Pressable onPress={onPress} accessibilityLabel={title}
      style={[styles.btn, primary ? { backgroundColor: accent.primary } : { borderWidth: 1, borderColor: theme.line }]}>
      <T mono size={13} w={800} color={primary ? '#fff' : theme.ink}>{text}</T>
    </Pressable>
  );
  const thumb = (
    <Pressable ref={band.ref} onLayout={band.onLayout} onPress={open} accessibilityLabel={tx('shell.miniPlayerBar.player')}
      style={[styles.thumb, { width: thumbW, height: thumbH, borderColor: theme.frame, backgroundColor: theme.surface2 }]}>
      {st.thumb && !thumbErr && <Image source={st.thumb} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setThumbErr(true)} />}
    </Pressable>
  );
  const title = (
    <Pressable onPress={open} style={row.mode === 'stack' && !full ? styles.stackTitle : styles.grow}>
      <Marquee text={label} color={theme.ink} />
      <View style={styles.sub}>
        <T mono size={8} dim numberOfLines={1}>{st.kind === 'live' ? tx('shell.miniPlayerBar.watchingLive') : tx('shell.miniPlayerBar.playing')}</T>
        {st.kind !== 'live' && t.duration > 0 && <T mono size={8} dim numberOfLines={1}>{`${fmt(t.current)} / ${fmt(t.duration)}`}</T>}
      </View>
    </Pressable>
  );
  const buttons = (
    <>
      {btn(st.playing ? '❙❙' : '▶', st.toggle, st.playing ? tx('recresult.encode.pause') : tx('library.video.playA11y'), true)}
      {st.canNext && btn('▶❙', st.next, tx('shell.miniPlayerBar.next'))}
      {btn('✕', () => miniPlayer.setSession(null), tx('common.end'))}
    </>
  );
  // 帯が高い時は、映像の右に題名（上）とボタン（下）を縦に積む。もっと高い時は題名を縦書き、ボタンを縦1列にする
  const side = row.mode === 'tall'
    ? <View style={[styles.tall, { height: thumbH }]}>
      <Pressable onPress={open} accessibilityLabel={label}><VerticalTitle text={label} height={thumbH} color={theme.ink} /></Pressable>
      <View style={styles.btnCol}>{buttons}</View>
    </View>
    : row.mode === 'stack'
      ? <View style={[styles.side, { height: thumbH }]}>{title}<View style={styles.btns}>{buttons}</View></View>
      : <>{title}{buttons}</>;
  const bg = theme.isDark ? 'rgba(14,11,20,0.94)' : 'rgba(255,255,255,0.94)';
  return (
    <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
      style={[full ? styles.barFull : [styles.bar, { height: row.h + 14 }], { borderTopColor: theme.line, backgroundColor: bg }]}>
      {full ? <>{thumbW > 0 && thumb}<View style={styles.under}>{title}{buttons}</View></> : <>{thumb}{side}</>}
      {/* 再生位置（帯の下端）。ライブは尺が無いので出さない */}
      {st.kind !== 'live' && (
        <View style={[styles.track, { backgroundColor: theme.line }]}>
          <View style={{ width: `${t.duration ? Math.min(100, (t.current / t.duration) * 100) : 0}%`, height: '100%', backgroundColor: accent.primary }} />
        </View>
      )}
    </View>
  );
}

/** はみ出す時だけ横に流す（同じ文を2つ並べて途切れずに繋ぐ。長い題名ほど速くならないよう字数で秒数を決める） */
function Marquee({ text, color }: { text: string; color: string }) {
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const flow = textW > boxW + 2 && boxW > 0;
  // 流すのは前にいる間だけ。JS で毎コマ動かすと背面（小窓で再生中）でも毎コマ画面へ反映し、
  // メインスレッドを塞いで小窓の操作が効かず、戻っても小窓が閉じなかった（2026-11-16、実機）
  const appActive = useAppActive();
  useEffect(() => {
    x.setValue(0);
    if (!flow || !appActive) return;
    const sec = Math.max(8, Math.round((text.length + GAP / 8) / 2.2));
    const a = Animated.loop(Animated.timing(x, { toValue: -(textW + GAP), duration: sec * 1000, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [flow, textW, text, x, appActive]);
  return (
    <View style={styles.marquee} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* 流す時は2つ分の幅を与える（与えないと各々が箱の幅で切られる） */}
      <Animated.View style={[styles.row, flow && { width: (textW + GAP) * 2 }, { transform: [{ translateX: x }] }]}>
        <T size={11} w={700} color={color} numberOfLines={1} style={flow ? { width: textW + GAP, paddingRight: GAP } : styles.fit}>{text}</T>
        {flow && <T size={11} w={700} color={color} numberOfLines={1} style={{ width: textW + GAP, paddingRight: GAP }}>{text}</T>}
      </Animated.View>
      {/* 文の本来の幅を測る（見えない） */}
      <View style={styles.measure} pointerEvents="none">
        <T size={11} w={700} onLayout={(e) => setTextW(e.nativeEvent.layout.width)}>{text}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10, borderTopWidth: 1 },
  barFull: { gap: 7, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 10, borderTopWidth: 1 },
  under: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  thumb: { borderRadius: 7, overflow: 'hidden', borderWidth: 1.5, flexShrink: 0 },
  grow: { flex: 1, minWidth: 0 },
  side: { flex: 1, minWidth: 0, justifyContent: 'space-between' },
  stackTitle: { minWidth: 0 },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  tall: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  btnCol: { justifyContent: 'space-between', gap: 4 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  marquee: { overflow: 'hidden', width: '100%' },
  row: { flexDirection: 'row' },
  fit: { maxWidth: '100%' },
  measure: { position: 'absolute', opacity: 0, left: 0, top: 0, width: 4000, flexDirection: 'row' },
});
