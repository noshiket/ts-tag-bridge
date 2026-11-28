import { AUDIO_ONLY, nextChapterTarget, prevChapterTarget, totToPos } from '@tstag/core';
import { useAlbumCaptures, useApi, useStreamMarks } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useControlsVisibility, useAudioMode, useRelocateOnLeave, watchTitle } from './playerSideEffects';
import { StageOverlays } from './StageOverlays';
import { useCommentLayers } from './useCommentLayers';
import { useSessionRecovery } from './useSessionRecovery';
import { usePlayerKeyHandlers } from './usePlayerKeyHandlers';
import { useWatchMiniPlayer } from './useWatchMiniPlayer';
import { useWatchSplit } from './useWatchSplit';
import { WatchControls } from './WatchControls';
import type { VideoSurfaceHandle } from '../surface';
import { useFullscreen } from '../useFullscreen';
import { useRotation } from '../useRotation';
import { PlayerShortcutHelp } from '../PlayerShortcutHelp';
import { usePlayback, type StartFrom } from '../usePlayback';
import { useTakeCapture } from '../useTakeCapture';
import { VideoSurface } from '../VideoSurface';
import { WatchMenuSheet } from '../WatchMenuSheet';
import { WatchSidePanel } from '../tabs/WatchSidePanel';
import { useEpisodeNav } from '../useEpisodeNav';
import { usePlayerDevicePrefs } from '../usePlayerDevicePrefs';
import { useTapSkip } from '../useTapSkip';
import { useWatchTabs } from '../tabs/watchTabs';
import { isAppActive, useAppActive } from '../../../lib/lifecycle/appActive';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import type { LocalBundle } from '../../../lib/localSave/backend.types';
import { localSave } from '../../../lib/localSave/store';
import { miniPlayer, type WatchParams } from '../../../lib/playback/miniPlayer';
import { useTheme } from '../../../ui/theme/Tweaks';
import { isLandscape } from '../../../lib/playback/landscape';

/** この幅からは PC の並び（映像の右にパネル。元の Web 版と同じ境目） */
const PC_WIDTH = 900;

/** 再生画面の中身（WatchPlayer がローカル保存を読んでから描く）。状態と付帯の処理は watch/ のフック、操作の表示は WatchControls */
export function WatchPlayerBody({ params, active, band = false, go, local }: { params: WatchParams; active: boolean; band?: boolean; go: (p: WatchParams) => void; local: LocalBundle | null }) {
  useBgRenderCount('WatchPlayer');
  const api = useApi();
  const { id, from, tot, kind } = params;
  const videoId = Number(id);
  const rec = kind === 'rec';
  const target = useMemo(() => ({ kind: rec ? 'video' as const : 'vdb' as const, id: videoId }), [rec, videoId]);
  const { theme } = useTheme();
  const node = params.node ?? null;
  // 隣の話数・曲もこの端末に保存してあれば保存から（元と同じ）
  const at = (p: Omit<WatchParams, 'node'>) =>
    go({ ...p, ...(node ? { node } : {}), ...(!rec && localSave.isSaved(Number(p.id), node) ? { local: '1' } : {}) });
  const startFrom = useMemo<StartFrom>(() => (from === 'start' ? { start: true } : tot ? { tot } : null), [from, tot]);
  const pb = usePlayback(target, node, startFrom, local);
  const marks = useStreamMarks(target, node);
  const chapters = marks.data?.chapters ?? [];
  const surface = useRef<VideoSurfaceHandle>(null);
  const [time, setTime] = useState({ current: 0, duration: 0, buffered: 0 });
  // 背面の間に進んだ分は、前に戻った時にまとめて反映する
  const lastTime = useRef(time);
  const appActive = useAppActive();
  useEffect(() => {
    if (!appActive) return;
    setTime(lastTime.current);
    miniPlayer.setTime(lastTime.current.current, lastTime.current.duration);
  }, [appActive]);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  // 「プレイヤーを再起動」で映像の部品ごと作り直す（保存した動画・直接再生は URL が変わらないため）
  const { status, onStatus, playerKey, restartPlayer } = useSessionRecovery(!!pb.source && !pb.direct, pb.restart);   // 片付けられたセッションも作り直す
  const prefs = usePlayerDevicePrefs();
  // 並び（元と同じ）: PC は映像の右にパネル（▤ で開閉）。スマホ・タブレットは縦なら映像の下、横に倒したら映像だけ。全画面は映像だけ。
  // 縦持ちで ⟳ を押したら画面ごと 90° 回して横として並べる（Web だけ・PC の幅では出さない）。全画面は向きそのままで最大表示（Web は回さない）。
  // アプリ（iOS/Android）は全画面で端末の向きを横に固定する（縦長の動画は縦）
  const [aspect, setAspect] = useState(16 / 9), portrait = aspect < 1;   // 映像の縦横比（弾幕の枠・キャプチャにも使う）
  const [fullscreen, toggleFullscreen] = useFullscreen(active, portrait);
  const rot = useRotation(active);
  const isPC = rot.real.width >= PC_WIDTH;
  const landscape = isLandscape(rot.win, rot.rotated), wide = isPC || landscape;   // Web はキーボードで高さが縮んでも向きを変えない
  const [panelOpen, setPanelOpen] = useState(true);
  const showPanel = !fullscreen && (isPC ? panelOpen : !landscape);
  const meta = pb.meta.data;
  // 端末保存した録画は 1 ファイルに主・副の音声が入っているので、プレイヤーのトラックをそのまま選び替える（Web はトラックを読めないため保存再生では切替なし。Web で音声を変えるには副音声で保存し直す）
  const [ntracks, setNtracks] = useState<{ id: number; label: string }[]>([]);
  const [ncur, setNcur] = useState<number | null>(null);
  const syncNativeAudio = useCallback(() => {
    if (!local) { setNtracks([]); setNcur(null); return; }
    setNtracks(surface.current?.audioTracks() ?? []);
    setNcur(surface.current?.currentAudioTrack() ?? null);
  }, [local]);
  // トラックの一覧は読み終えてからでないと空なので、ready になったら一呼吸置いて読む
  useEffect(() => {
    if (!local || status.s !== 'ready') return;
    const t = setTimeout(syncNativeAudio, 0);
    return () => clearTimeout(t);
  }, [local, status, playerKey, syncNativeAudio]);
  // 日本語の副音声は常に二番目（サーバーも -map 0:a:1）なので 0 と 1 を往復する
  const toggleNativeAudio = () => {
    if (ntracks.length < 2) return;
    const cur = surface.current?.currentAudioTrack() ?? ncur ?? 0;
    const next = cur === 0 ? 1 : 0;
    surface.current?.selectAudioTrack(next);
    setNcur(next);
  };
  const hasSecondaryAudio = local ? ntracks.length >= 2 : (!!meta?.has_secondary_audio && !pb.direct);
  const secondaryAudio = local ? (ncur ?? 0) !== 0 : pb.secondaryAudio;
  const onToggleAudio = local ? toggleNativeAudio : pb.toggleAudio;
  const audioToggle = hasSecondaryAudio ? onToggleAudio : undefined;
  // 音楽の波形とスペクトラム（元と同じく、サーバーが前もって解析した値。ライブラリの音楽だけ）
  const isMusic = meta?.media_kind === 'audio';
  const viz = useQuery({ queryKey: ['audioviz', node ?? '', videoId], queryFn: () => api.stream.audioViz(videoId, node), enabled: isMusic && !rec, staleTime: Infinity, retry: false });
  const nowRef = useCallback(() => surface.current?.now() ?? 0, []);
  const audioOnly = pb.quality === AUDIO_ONLY;
  const layers = useCommentLayers(target, node, meta, audioOnly);
  const watchTabs = useWatchTabs(meta, rec, node, !!layers.commentTracks);
  const { tab, tabAddon } = watchTabs;
  const ui = useControlsVisibility(playing);
  const durationGuess = time.duration || meta?.duration || 0;
  const split = useWatchSplit({ rec, tab, videoId, node, surface, now: time.current, duration: durationGuess, playing });
  // 戻っても再生は続ける（下のミニプレイヤーへ。止めるのはミニプレイヤーの ✕。元と同じ）
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  useRelocateOnLeave(videoId, node, rec);
  const { series, queue, goEpisode, canNext } = useEpisodeNav({ meta, videoId, node, rec, open: at });
  // このアルバムのキャプチャ（タブを開いた時だけ読む）。同じ動画のものはその場で、別の話はその動画へ
  const albumCaptures = useAlbumCaptures(meta?.album_id ?? 0, node, tab === 'capture' && meta?.album_id != null);
  const playCaptureAt = (c: { video_id: number | null; tot: string | null }) => {
    if (c.video_id == null || !c.tot) return;
    const pos = c.video_id === videoId && !rec && meta ? totToPos(meta, Date.parse(c.tot)) : null;
    if (pos != null) surface.current?.seek(Math.max(0, pos));
    else at({ id: String(c.video_id), tot: c.tot });
  };
  const nextChapter = () => { const to = nextChapterTarget(chapters, time.current); if (to === 'nextEpisode') goEpisode(1); else surface.current?.seek(to); };
  const prevChapter = () => { const to = prevChapterTarget(chapters, time.current); if (to === 'prevEpisode') goEpisode(-1); else surface.current?.seek(to); };
  const title = watchTitle(meta);
  const stageSize = useRef({ width: 0, height: 0 });
  const takeCapture = useTakeCapture({
    videoId, rec, meta, title, surface, stage: stageSize, aspect,
    comments: layers.commentsOn && !audioOnly ? layers.flowing : null,
    captions: layers.captionOn && !audioOnly ? layers.captions : null,
    danmaku: layers.danmaku,
  });
  const audioMode = useAudioMode({ isMusic, audioOnly, title, meta, posterUri: local?.posterUri, rec, videoId, node });

  // 隠れたら全画面をやめる
  useEffect(() => { if (!active && fullscreen) toggleFullscreen(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useWatchMiniPlayer({ meta, title, rec, videoId, node, posterUri: local?.posterUri, playing, canNext, surface, next: () => goEpisode(1) });

  const togglePlay = () => { if (playing) surface.current?.pause(); else surface.current?.play(); };
  // 位置は映像から読む（画面の時刻は飛び終えるまで前のまま。続けて押すと前の位置から数えてしまう）
  const now = () => surface.current?.now() ?? time.current;
  const skip = (sec: number) => surface.current?.seek(Math.max(0, Math.min(durationGuess, now() + sec)));
  // 続けてタップで飛ばす（2回目から左は10秒戻る・右は10秒進む）。1回だけなら操作の表示の出し入れ
  const tapSkip = useTapSkip({ width: () => stageSize.current.width, rotated: rot.rotated, skip, onSingleTap: () => { if (ui.visible && playing) ui.setVisible(false); else ui.bump(); } });
  const { keyHandlers, keys } = usePlayerKeyHandlers({
    active, ui, surface, meta, rec, layers, pb, prefs, durationGuess, now, skip, togglePlay, toggleFullscreen, prevChapter, nextChapter, goEpisode, setRate, back, audioToggle,
  });

  return (
    // band: 帯の枠に縮めて映像と弾幕・字幕だけ出す（操作は帯から。パネルは消さずに隠す。作り直すと重い）
    <SafeAreaView edges={band || fullscreen || rot.rotated ? [] : ['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: band || wide || fullscreen ? '#000' : theme.bg, flexDirection: wide && !fullscreen ? 'row' : 'column' }, rot.style]}>
      {active && <StatusBar hidden={fullscreen || rot.rotated} />}
      <Pressable style={[styles.stage, band ? StyleSheet.absoluteFill : wide || fullscreen ? styles.stageFill : styles.stageTop]}
        onLayout={(e) => { stageSize.current = e.nativeEvent.layout; }} onPress={tapSkip.onTap}>
        <VideoSurface key={playerKey} ref={surface} source={pb.source} startAt={pb.startAt} muted={prefs.muted} volume={prefs.volume} rate={rate}
          style={StyleSheet.absoluteFill} audioMode={audioMode}
          onTime={(t) => {
            // 位置の保存はいつでも。画面の描き直しは前に出ている時だけ（背面で描き直すと小窓の映像が止まった）
            pb.onTime(t.current, t.duration);
            lastTime.current = t;
            if (!isAppActive()) return;
            setTime(t);
            miniPlayer.setTime(t.current, t.duration);
          }}
          onPlayingChange={(p) => { setPlaying(p); if (!p) pb.onPaused(); }}
          onVideoSize={(s) => setAspect(s.width / s.height)}
          onStatus={onStatus}
          pip={{
            active, captions: layers.pipCaptions, comments: layers.pipComments, captionsOn: layers.captionOn, commentsOn: layers.commentsOn,
            // Web と同じ大きさ（34*(幅/1024)*1.25*倍率 を 16:9 の高さで割ったもの）と不透明度
            fontRatio: (34 * 1.25 * (16 / 9) / 1024) * (layers.settings.comment_font_scale || 1), opacity: layers.settings.comment_opacity ?? 0.5,
            duration: durationGuess,
            // ✕ で閉じたら止める（アプリに戻る操作なら続ける。元と同じ）
            onChange: (c) => { miniPlayer.setPip(c.active); if (!c.active && !c.restored) surface.current?.pause(); },
          }}
          onEnded={() => {
            setPlaying(false);
            // 並びで聴いている間は「続けて流す」に関わらず次の曲へ（並びを積むこと自体が続けて聴く指定）。1曲の繰り返しは頭から
            if (queue.has(videoId) && queue.repeat() === 'one') { surface.current?.seek(0); surface.current?.play(); return; }
            if (prefs.autoNext || queue.has(videoId)) goEpisode(1);
          }} />
        <StageOverlays layers={layers} time={time.current} playing={playing} rate={rate} audioOnly={audioOnly} status={status}
          loadError={pb.meta.error?.message ?? null} viz={isMusic ? viz.data ?? null : null} now={nowRef} surface={surface} tapFeedback={tapSkip.feedback}
          logoRect={rec && tabAddon?.player_ui === 'logo_rect'} splitFrame={split.active ? { dbRecId: videoId, t: split.focusT, node } : null} poster={{ rec, videoId, node, local: local?.posterUri }} aspect={aspect} band={band} />
        {!band && <WatchControls ui={ui} title={title} videoId={videoId} rec={rec} pb={pb} meta={meta} playing={playing} time={time} duration={durationGuess} rate={rate} setRate={setRate}
          chapters={chapters} marks={marks.data} showSync={showPanel && tab === 'comment'} waveform={isMusic ? viz.data?.peaks ?? null : null}
          surface={surface} split={split} layers={layers} prefs={prefs} prevChapter={prevChapter} nextChapter={nextChapter} back={back} togglePlay={togglePlay} skip={skip}
          fullscreen={fullscreen} toggleFullscreen={toggleFullscreen} rot={rot} isPC={isPC} panelOpen={panelOpen} setPanelOpen={setPanelOpen} onMore={() => setMenuOpen(true)}
          hasSecondaryAudio={hasSecondaryAudio} secondaryAudio={secondaryAudio} onToggleAudio={onToggleAudio} />}
        {!band && <PlayerShortcutHelp open={keys.helpOpen} onClose={() => keys.setHelpOpen(false)} handlers={keyHandlers} />}
        {!band && keys.catcher}
      </Pressable>

      {showPanel && (
        <WatchSidePanel tabs={watchTabs} wide={wide} hidden={band} meta={meta} isMusic={isMusic} rec={rec} videoId={videoId} node={node}
          time={time.current} playing={playing} seek={(sec) => surface.current?.seek(sec)} pause={() => surface.current?.pause()}
          comments={layers.comments} commentsOn={layers.commentsOn} onToggleComments={layers.toggleComments}
          commentTracks={layers.commentTracks} commentTrack={layers.commentTrack} onCommentTrack={layers.setCommentTrack}
          captures={albumCaptures.data} onCapture={takeCapture} onPlayCaptureAt={playCaptureAt}
          series={series.data} onPlaySeries={(v) => { if (v.id !== videoId) at({ id: String(v.id) }); }}
          split={{ ready: split.ready, error: split.error, editor: split.editor, ctl: split.ctl }} />
      )}

      <WatchMenuSheet open={menuOpen && !band} onClose={() => setMenuOpen(false)} rate={rate} setRate={setRate}
        direct={pb.direct} local={!!local} isMusic={isMusic} videoCodec={meta?.video_codec}
        quality={pb.quality} setQuality={pb.setQuality} autoNext={prefs.autoNext} onToggleAutoNext={prefs.toggleAutoNext}
        onRestart={restartPlayer}
        onKeyHelp={keys.supported ? () => keys.setHelpOpen(true) : undefined} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stage: { backgroundColor: '#000', overflow: 'hidden' },
  stageTop: { width: '100%', aspectRatio: 16 / 9 },
  stageFill: { flex: 1 },
});
