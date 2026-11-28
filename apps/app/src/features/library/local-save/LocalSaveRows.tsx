import { localKey, shortDateTime, type LocalItem } from '@tstag/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useWaitingForWifi } from '../../../lib/localSave/cellular';
import { localSave, queuedLabel, useLocalSaveSelect, type ActiveItem } from '../../../lib/localSave/store';
import { Trash } from '../../../ui/parts/Icons';
import { ReelThumb, hueFromId } from '../../../ui/parts/ReelThumb';
import { StationLogo } from '../../../ui/parts/StationLogo';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 保存した分を再生する（通信が無くても開ける） */
export const playLocal = (it: LocalItem) =>
  router.push({ pathname: '/watch/[id]', params: { id: String(it.id), local: '1', ...(it.node ? { node: it.node } : {}) } });

/** 保存した時に控えたサムネ（通信が無くても出る） */
/** 端末に保存したサムネ（無ければ null） */
export function useLocalPoster(id: number, node: string | null) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let made: string | null = null;
    void localSave.posterUri(id, node).then((u) => { made = u; if (!dead) setUri(u); });
    return () => { dead = true; if (made?.startsWith('blob:')) URL.revokeObjectURL(made); };
  }, [id, node]);
  return uri;
}

function SavedThumb({ it }: { it: LocalItem }) {
  const uri = useLocalPoster(it.id, it.node);
  return <ReelThumb source={uri ? { uri } : null} hue={hueFromId(it.id)} width={46} height={34} />;
}

/** 控えた情報の行（局・シリーズ／話数・題名／字幕・勢い） */
function Lines({ it }: { it: LocalItem }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const hasEp = !!it.episodeNum;
  const main = it.episodeName || (hasEp ? '' : it.title || `vdb:${it.id}`);
  const perMin = it.commentCount && it.durationSec ? Math.round(it.commentCount / (it.durationSec / 60)) : null;
  return (
    <>
      <View style={styles.line}>
        {it.onid != null && it.sid != null ? <StationLogo onid={it.onid} sid={it.sid} name={it.stationName} height={12} maxWidth={22} />
          : it.stationName ? <T mono size={9} dim>{it.stationName}</T> : null}
        {!!it.series && <T mono size={9} dim numberOfLines={1} style={styles.shrink}>{it.series}</T>}
      </View>
      <View style={styles.line}>
        {hasEp && <View style={[styles.ep, { backgroundColor: accent.tertiary }]}><T mono size={10} w={700} color="#fff">{`#${it.episodeNum}`}</T></View>}
        {!!main && <T size={13} w={700} numberOfLines={1} style={styles.shrink}>{main}</T>}
      </View>
      {(it.hasCaption || perMin != null) && (
        <View style={styles.line}>
          {it.hasCaption && <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={8} dim>{tx('library.video.cc')}</T></View>}
          {perMin != null && <T mono size={8} w={800} dim>{tx('library.localSaveRows.heat', { v0: (it.commentCount ?? 0).toLocaleString(), v1: perMin })}</T>}
        </View>
      )}
    </>
  );
}

/** 保存中・待機中（まだ再生できない）。進み具合はこの行だけが読む */
export function ActiveRow({ it }: { it: ActiveItem }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const progress = useLocalSaveSelect((s) => s.states[localKey(it.id, it.node)]?.progress ?? it.progress);
  const pct = Math.round(progress * 100);
  const waitWifi = useWaitingForWifi();
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.cardFrame, boxShadow: shadow(theme, 2) }]}>
      <SavedThumb it={it} />
      <View style={styles.grow}>
        <Lines it={it} />
        {it.status === 'downloading' ? (
          <View style={[styles.line, styles.mt3]}>
            <View style={[styles.track, { backgroundColor: theme.line }]}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: accent.primary }} /></View>
            <T mono size={9} dim>{waitWifi ? `${pct}% Wi-Fi 待ち` : `${pct}%`}</T>
          </View>
        ) : <T mono size={9} dim style={styles.mt3}>{queuedLabel(progress)}</T>}
      </View>
      <Pressable onPress={() => void localSave.cancel(it.id, it.node)} accessibilityLabel={tx('library.localSaveRows.cancelDownload')} style={styles.cancel}>
        <T mono size={10} w={700} dim>{tx('library.local.cancel')}</T>
      </Pressable>
    </View>
  );
}

/** カードが引けない時の保存済みの行（通信なし・ライブラリから消えた） */
export function SavedRow({ it }: { it: LocalItem }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.cardFrame, boxShadow: shadow(theme, 2) }]}>
      <Pressable onPress={() => playLocal(it)} style={[styles.grow, styles.press]}>
        <SavedThumb it={it} />
        <View style={styles.grow}>
          <Lines it={it} />
          <View style={[styles.line, styles.mt1]}>
            <T mono size={9} dim>{tx('library.localSaveRows.saved', { v0: it.cachedAt ? shortDateTime(it.cachedAt) : '' })}</T>
            {it.audio === 'secondary' && <View style={[styles.tag, styles.sub]}><T mono size={8} w={700} color="#fff">{tx('library.local.saveSap')}</T></View>}
          </View>
        </View>
        <T size={13} w={700} color={accent.primary}>▶</T>
      </Pressable>
      <Pressable onPress={() => void localSave.remove(it.id, it.node)} accessibilityLabel={tx('library.localSaveRows.deleteLocalCache')}
        style={[styles.trash, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Trash s={13} c={theme.mute} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  press: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  ep: { paddingHorizontal: 5, borderRadius: 3 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  sub: { backgroundColor: '#B57BFF' },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  mt1: { marginTop: 1 },
  mt3: { marginTop: 3 },
  cancel: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 6 },
  trash: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
