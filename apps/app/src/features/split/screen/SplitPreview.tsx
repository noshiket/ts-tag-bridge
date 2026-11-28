import { fmtMs } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Btn } from '../common/splitButtons';
import type { SplitScreenState } from './useSplitScreen';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { VideoSurface } from '../../player/VideoSurface';
import type { VideoSurfaceHandle } from '../../player/surface';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 分割画面の上: プレビュー（採用区間の外・置きかけのトリムを重ねる）と、再生・コマ送り・切れ目へ飛ぶボタン */
export function SplitPreview({ s }: { s: SplitScreenState }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { pendingKeep, FRAME } = s.ed;
  return (
    <View style={styles.pad}>
      <View>
        <PreviewFrame dbRecId={s.src.dbRecId} node={s.node} playhead={s.playhead} frame={s.playheadFrame} playing={s.playing} seekStart={s.seekStart.current}
          onTime={(t) => { s.setPlayhead(Math.min(s.total, t)); s.setPlayheadFrame(null); }} onEnded={() => s.setPlaying(false)} frameStatus={s.frameStatus} />
        {s.removed && (
          <View pointerEvents="none" style={[styles.veil, { backgroundColor: 'rgba(180,20,30,0.55)' }]}>
            <View style={styles.veilTag}><T mono size={11} w={800} color="#FFB3AE">{tx('split.splitPreview.removedOutsideKeptRanges')}</T></View>
          </View>
        )}
        {pendingKeep !== null && (
          <View pointerEvents="none" style={[styles.veil, { backgroundColor: 'rgba(60,80,200,0.45)' }]}>
            {pendingKeep.in != null && <View style={styles.veilTag}><T mono size={11} w={800} color="#B9C7FF">{`TRIM IN · ${fmtMs(pendingKeep.in)}`}</T></View>}
            {pendingKeep.out != null && <View style={styles.veilTag}><T mono size={11} w={800} color="#B9C7FF">{`TRIM OUT · ${fmtMs(pendingKeep.out)}`}</T></View>}
          </View>
        )}
      </View>
      <View style={styles.transport}>
        <Btn onPress={() => s.jumpCut(-1)} style={styles.icon}>|◀</Btn>
        <Btn onPress={() => s.nudge(-FRAME)} style={styles.icon}>◀F</Btn>
        <Btn onPress={() => s.nudge(-1)} style={styles.icon}>−1s</Btn>
        <Pressable onPress={s.togglePlay} style={[styles.playBtn, { backgroundColor: accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
          <T size={12} w={800} color="#fff">{s.playing ? '❚❚' : '▶'}</T>
        </Pressable>
        <Btn onPress={() => s.nudge(1)} style={styles.icon}>+1s</Btn>
        <Btn onPress={() => s.nudge(FRAME)} style={styles.icon}>F▶</Btn>
        <Btn onPress={() => s.jumpCut(1)} style={styles.icon}>▶|</Btn>
        <View style={styles.flex} />
        <View style={[styles.phBadge, { backgroundColor: theme.ink }]}><T mono size={10} w={700} color={theme.onInk}>{`${fmtMs(s.playhead)} #${s.efn(s.playhead)}`}</T></View>
      </View>
    </View>
  );
}

/** 止めている間はその位置のコマ、再生中は映像（Web は fMP4 の流し、iOS は HLS） */
function PreviewFrame({ dbRecId, node, playhead, frame, playing, seekStart, onTime, onEnded, frameStatus }: {
  dbRecId: number; node: string | null; playhead: number; frame: number | null; playing: boolean; seekStart: number;
  onTime: (t: number) => void; onEnded: () => void; frameStatus: string | null;
}) {
  const api = useApi();
  const { theme } = useTheme();
  const live = api.recordings.frameUrl(dbRecId, Number(playhead.toFixed(3)), node, frame);
  const [frozen, setFrozen] = useState(live);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (playing) return;
    setLoading(true);
    const id = setTimeout(() => setFrozen(live), 300);
    return () => clearTimeout(id);
  }, [live, playing]);
  const headers = api.client.authHeaders();
  const img = useMemo(() => ({ uri: frozen, headers }), [frozen]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = useMemo(() => (playing ? {
    uri: Platform.OS === 'web' ? api.recordings.videoStreamUrl(dbRecId, seekStart, node) : api.recordings.hlsUrl(dbRecId, seekStart, 600, node), headers,
  } : null), [playing, seekStart, dbRecId, node]); // eslint-disable-line react-hooks/exhaustive-deps
  const surface = useRef<VideoSurfaceHandle>(null);
  return (
    <View style={[styles.preview, { borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
      {!playing && <Image source={img} contentFit="contain" style={StyleSheet.absoluteFill} onLoad={() => setLoading(false)} onError={() => setLoading(false)} />}
      {!playing && loading && <View style={[StyleSheet.absoluteFill, styles.center, styles.dim]}><T size={13} color="#fff">Loading...</T></View>}
      {!playing && frameStatus && (
        <View style={styles.badge}>
          <T mono size={9} w={800} color={frameStatus === 'ready' ? '#7CFC9E' : frameStatus === 'building' ? '#FFD60A' : '#bbb'}>
            {frameStatus === 'ready' ? '厳密フレーム' : frameStatus === 'building' ? '近似(厳密を生成中…)' : '近似フレーム'}
          </T>
        </View>
      )}
      {playing && source && (
        <VideoSurface ref={surface} source={source} startAt={0} muted={false} volume={1} rate={1} style={StyleSheet.absoluteFill}
          onTime={(t) => onTime(seekStart + t.current)} onPlayingChange={() => {}} onStatus={(st) => { if (st === 'ready') surface.current?.play(); }} onEnded={onEnded} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 18, paddingBottom: 12, paddingTop: 4 },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  preview: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5 },
  badge: { position: 'absolute', top: 6, right: 6, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'flex-end', padding: 12, gap: 5 },
  veilTag: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.75)' },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  icon: { minWidth: 30, height: 30, justifyContent: 'center' },
  playBtn: { width: 42, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  phBadge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7 },
});
