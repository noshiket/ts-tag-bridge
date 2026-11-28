import { tNow } from '../../ui/i18n/I18n';
import { liveProgress, type LiveChannel } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveControls, LiveMenuSheet, LiveStageStatus } from './player/LiveControls';
import { useLiveControlsVisible, useLiveMiniPlayer } from './player/liveScreenEffects';
import { LiveSidePanel, type LiveTab } from './player/LiveSidePanel';
import { useLiveEvents } from './player/useLiveEvents';
import { useLiveToggles } from './player/useLiveToggles';
import { LiveSurface } from './LiveSurface';
import type { LiveCommand, LiveSurfaceHandle } from './surface';
import { useLivePip } from './useLivePip';
import { PlayerShortcutHelp } from '../player/PlayerShortcutHelp';
import { useFullscreen } from '../player/useFullscreen';
import { usePlayerKeys } from '../player/usePlayerKeys';
import { useRotation } from '../player/useRotation';
import { useAppActive } from '../../lib/lifecycle/appActive';
import { useCommentSettings } from '../../lib/playback/commentSettings';
import { useTheme } from '../../ui/theme/Tweaks';
import { isLandscape } from '../../lib/playback/landscape';
import { miniPlayer } from '../../lib/playback/miniPlayer';

const PC_WIDTH = 900;
const PANEL_WIDTH = 240;

/**
 * ライブ視聴（元の live.jsx の LivePlayer）。映像・字幕・弾幕・実況の受信はプレイヤーのページ（mpegts.js）、
 * 操作・番組情報・コメント一覧・キャプチャはこちら。
 * 画面を離れても視聴は続く（PlayerHost が隠して鳴らし続け、下のミニプレイヤーから操作する。元と同じ）。
 * 知らせと命令は player/useLiveEvents、切り替えは player/useLiveToggles、操作の表示は player/LiveControls
 */
/** band: 下の帯のサムネの枠に映像だけを出している（PlayerHost が枠の大きさに置く） */
export function LivePlayer({ channel, node, onBack, active = true, band = false }: { channel: LiveChannel; node: string | null; onBack: () => void; active?: boolean; band?: boolean }) {
  const api = useApi();
  const { theme } = useTheme();
  const surface = useRef<LiveSurfaceHandle>(null);
  const cmd = (c: LiveCommand) => surface.current?.command(c);
  const channelId = channel.display_channel_id;
  const [quality, setQuality] = useState('720p');
  const [tab, setTab] = useState<LiveTab>('program');
  const [menuOpen, setMenuOpen] = useState(false);
  const cs = useCommentSettings();
  // 全画面: アプリは端末の向きごと横にする。Web は向きそのままで最大表示（回さない）
  const [fullscreen, toggleFullscreen] = useFullscreen(active);
  // 縦持ちで ⟳ を押したら画面ごと 90° 回して横として並べる（元と同じ。Web だけ・PC の幅では出さない）
  const rot = useRotation(active);
  const isPC = rot.real.width >= PC_WIDTH;
  const landscape = isLandscape(rot.win, rot.rotated), wide = isPC || landscape;   // Web はキーボードで高さが縮んでも向きを変えない
  const [panelOpen, setPanelOpen] = useState(true);
  const showPanel = !band && !fullscreen && (isPC ? panelOpen : !landscape);

  // 番組情報（放送中と次。30秒ごとに取り直す）と、残り時間を動かす1秒の刻み
  const onair = useQuery({ queryKey: ['live', 'onair', node ?? '', channelId], queryFn: () => api.live.onair(channel, node), refetchInterval: 30_000 });
  const cur = onair.data?.[0] ?? null;
  const next = onair.data?.[1] ?? null;
  const [, setTick] = useState(0);
  // 背面（小窓で再生中など）の間は描き直さない（小窓の映像を送る処理と同じスレッドを塞がないように）
  const appActive = useAppActive();
  useEffect(() => { if (!cur || !appActive) return; const iv = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(iv); }, [cur, appActive]);
  const pv = liveProgress(cur, next);
  const hasSecondary = !!cur?.has_secondary_audio;

  const ev = useLiveEvents(surface, channel, quality, appActive);
  const t = useLiveToggles(cmd, hasSecondary);
  const { visible, setVisible, bump } = useLiveControlsVisible(ev.status.status === 'ONAir');
  // コメントの表示設定はすぐ弾幕へ
  useEffect(() => { cmd({ type: 'settings', settings: cs as unknown as Record<string, unknown> }); }, [cs]); // eslint-disable-line react-hooks/exhaustive-deps

  // iOS: 字幕・弾幕を焼き込んだ小窓（サーバーのライブの HLS を使う）。開いている間は画面側を止め、
  // アプリに戻ったら最新の位置から見直す。✕で閉じたら止めたまま（録画と同じ）
  const livePip = useLivePip({
    channelId, quality, node, enabled: active && ev.status.status === 'ONAir', playing: !ev.st.paused,
    volume: t.volume, muted: t.muted, captionOn: t.captionOn, commentsOn: t.commentsOn,
    onChange: (e) => {
      ev.setPipActive(e.active);
      miniPlayer.setPip(e.active);
      if (e.active) cmd({ type: 'pause' });
      // 止めた分は古いので作り直す（先に止めた印を外さないと、作り直した後も止まったままになる）
      else if (e.restored) { cmd({ type: 'play' }); cmd({ type: 'restart' }); }
    },
  });
  const canPip = livePip.armed || ev.pipSupported;
  const startPip = () => (livePip.armed ? livePip.start() : cmd({ type: 'pip' }));
  const loading = !ev.error && !ev.st.paused && (ev.status.status !== 'ONAir' || ev.st.buffering);

  // キーボード操作（Web。元と同じ割り当て。ライブにシーク・速度は無い）
  const keyHandlers = {
    togglePlay: () => cmd({ type: ev.st.paused ? 'play' : 'pause' }),
    adjustVolume: t.adjustVolume, toggleMute: t.toggleMute, toggleFullscreen,
    togglePip: canPip ? startPip : undefined,
    toggleCaption: t.toggleCaption, toggleComments: t.toggleComments,
    toggleAudio: hasSecondary ? t.toggleAudio : undefined,
    back: onBack,
  };
  const keys = usePlayerKeys(keyHandlers, { enabled: active, uiVisible: visible, onActivity: bump });

  // 隠れたら全画面をやめる
  useEffect(() => { if (!active && fullscreen) toggleFullscreen(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveMiniPlayer(channel, ev.st.paused, surface);
  return (
    <SafeAreaView edges={band || fullscreen || rot.rotated ? [] : ['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: wide || fullscreen ? '#000' : theme.bg, flexDirection: wide && !fullscreen ? 'row' : 'column' }, rot.style]}>
      {active && <StatusBar hidden={fullscreen || rot.rotated} />}
      <Pressable style={[styles.stage, band ? StyleSheet.absoluteFill : wide || fullscreen ? styles.flex : styles.stageTop]} onPress={() => (visible ? setVisible(false) : bump())}>
        {/* 焼き込みの小窓の映像の層。WebView の後ろに同じ大きさで置く（自動の小窓は層が画面に載っていることが条件） */}
        {livePip.view}
        <LiveSurface ref={surface} apiBase={api.live.base(node)} channelId={channelId} quality={quality} style={StyleSheet.absoluteFill} onEvent={ev.onEvent}
          initial={{ volume: t.volume, muted: t.muted, captionOn: t.captionOn, commentsOn: t.commentsOn, audioTrack: t.audioTrack, settings: cs as unknown as Record<string, unknown> }} />
        {!band && <LiveStageStatus error={ev.error} loading={loading} status={ev.status} />}
        {visible && !band && (
          <LiveControls c={{
            title: channel.service_name || channelId, sub: `${channelId} / ${quality}`,
            program: cur ? `${cur.title}${pv?.remainMin ? ` · ${tNow('live.program.left', { n: pv.remainMin })}` : ''}` : null, progPct: pv ? pv.progPct : null,
            paused: ev.st.paused, bufferSec: ev.st.bufferSec, clients: ev.status.client_count ?? 0,
            t, hasSecondary, canPip, pipActive: ev.pipActive, fullscreen,
            rot: { show: rot.available && !isPC && !fullscreen, on: rot.on, toggle: rot.toggle },
            panel: { show: isPC && !fullscreen, open: panelOpen, toggle: () => setPanelOpen((o) => !o) },
            onBack, togglePlay: () => { cmd({ type: ev.st.paused ? 'play' : 'pause' }); bump(); }, startPip, toggleFullscreen, openMenu: () => setMenuOpen(true), bump,
          }} />
        )}
        <PlayerShortcutHelp open={keys.helpOpen} onClose={() => keys.setHelpOpen(false)} handlers={keyHandlers} />
        {keys.catcher}
      </Pressable>

      {showPanel && (
        <LiveSidePanel tab={tab} setTab={setTab} style={wide ? { width: PANEL_WIDTH, borderLeftWidth: 1, borderLeftColor: theme.line } : styles.flex}
          cur={cur} next={next} pv={pv} node={node} comments={ev.comments} notice={ev.notice} supported={ev.supported} commentsOn={t.commentsOn}
          onToggleComments={t.toggleComments} onSend={ev.sendComment} onCapture={ev.capture} />
      )}
      <LiveMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} quality={quality} setQuality={setQuality}
        restart={() => cmd({ type: 'restart' })} showKeys={keys.supported ? () => keys.setHelpOpen(true) : undefined} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  stage: { backgroundColor: '#000', overflow: 'hidden' },
  stageTop: { width: '100%', aspectRatio: 16 / 9 },
});
