import { resolveLiveChannel } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { EdgeSwipeBack } from './EdgeSwipeBack';
import { LiveMessage } from '../live/LiveMessage';
import { LivePlayer } from '../live/LivePlayer';
import { WatchPlayer } from '../player/WatchPlayer';
import { miniPlayer, useMiniPlayer, type LiveParams, type PlayerSession, type WatchParams } from '../../lib/playback/miniPlayer';
import { useViewNode } from '../../lib/state/viewNode';
import { useBgRenderCount } from '../../lib/lifecycle/bgRenders';
import { useMiniBandRect, type BandRect } from '../../lib/playback/miniBand';
import { useT } from '../../ui/i18n/I18n';

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <K extends string>(o: Record<string, string | undefined>, keys: readonly K[]) =>
  Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]])) as Partial<Record<K, string>>;

/** 開いている画面がプレイヤーなら、その指定（サーバーは開いた時のもので固定する） */
function sessionOf(path: string, q: Record<string, string | undefined>, viewNode: string | null): PlayerSession | null {
  const node = q.node || viewNode || undefined;
  const m = /^\/watch\/([^/]+)$/.exec(path);
  if (m) return { kind: 'watch', params: { id: decodeURIComponent(m[1]!), ...pick(q, ['kind', 'from', 'tot', 'local'] as const), ...(node ? { node } : {}) } };
  if (path === '/live' && q.sid && q.onid) return { kind: 'live', params: { sid: q.sid, onid: q.onid, ...(node ? { node } : {}) } };
  return null;
}

const isOpen = (s: PlayerSession, path: string) => (s.kind === 'watch' ? path.startsWith('/watch/') : path === '/live');

/**
 * プレイヤーの置き場所（元の shell.jsx と同じく、プレイヤーは画面を離れても作り直さない）。
 * 再生画面を開いている間は画面いっぱいに出し、離れたら 1px の箱へ押し込んで鳴らし続ける。
 * その間はタブの上のミニプレイヤーから操作する。閉じるのはミニプレイヤーの ✕ だけ
 */
export function PlayerHost() {
  useBgRenderCount('PlayerHost');
  const path = usePathname();
  const raw = useGlobalSearchParams();
  const { viewNode } = useViewNode();
  const q: Record<string, string | undefined> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, str(v)]));
  const qKey = JSON.stringify(q);
  // プレイヤーの画面を開いたら、それを鳴らす（離れても前のものを持ち続ける）
  useEffect(() => {
    const s = sessionOf(path, q, viewNode);
    // 開いた直後は、URL の引数だけ先に変わって画面はまだ元のまま（s が無い）ことがある。ここでは戻った時の指定を捨てない
    if (!s) return;
    // ミニプレイヤーから戻った・話数を移った時は、鳴らしている物の指定をそのまま使う。URL から作り直すと、
    // 自サーバーの物（URL にサーバーが無い）を今見ているサーバーの物と取り違え、その番号の保存を探して
    // 「ローカル保存が見つかりません」で止まった（見るサーバーを別のサーバーにしていた。2026-11-16、実機）
    // URL の引数は開いた後に少し遅れて揃い、ここがもう一度走る。その時も同じ物なら戻った時の指定のまま
    if (reopening && sameTarget(reopening, s)) { miniPlayer.setSession(reopening); return; }
    reopening = null;
    miniPlayer.setSession(s);
  }, [path, qKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { session } = useMiniPlayer();
  // この置き場所の左上（画面の座標。PC の幅では左の縦の帯の分ずれる）と、帯のサムネの枠
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const rect = useMiniBandRect();
  if (!session) return null;
  const active = isOpen(session, path);
  // 帯にいる間は、プレイヤーをそのままサムネの枠の大きさへ縮めて出す（iOS・Web とも。映像も弾幕・字幕も作り直さないので
  // 途切れない。iOS のライブは WebView の中の映像で、帯に写すこともできない）。帯の無い画面では見えない箱へ
  const band = !active && rect ? bandStyle(rect, origin) : null;
  return (
    <>
      <View ref={anchor} style={styles.anchor} pointerEvents="none"
        onLayout={() => anchor.current?.measureInWindow((x, y) => setOrigin((o) => (o.x === x && o.y === y ? o : { x, y })))} />
      <View style={active ? StyleSheet.absoluteFill : band ?? styles.hidden} pointerEvents={active ? 'auto' : 'none'}>
        {session.kind === 'watch'
          ? <WatchPlayer key={JSON.stringify(session.params)} params={session.params} active={active} band={!!band} go={(p) => goWatch(p, active)} />
          : <LiveSession key={JSON.stringify(session.params)} params={session.params} active={active} band={!!band} />}
        {/* 左の端から右へなぞって戻る（画面の出入りの動きを切っているため、ここで受ける） */}
        {active && <EdgeSwipeBack onBack={() => backFrom(session)} />}
      </View>
    </>
  );
}

/** 帯のサムネの枠線（1.5）の内側 */
const BAND_BORDER = 1.5;
const bandStyle = (r: BandRect, o: { x: number; y: number }) => ({
  position: 'absolute' as const, overflow: 'hidden' as const, borderRadius: 7 - BAND_BORDER,
  left: r.x - o.x + BAND_BORDER, top: r.y - o.y + BAND_BORDER, width: r.width - BAND_BORDER * 2, height: r.height - BAND_BORDER * 2,
});

/** 次に開く再生画面の指定（ミニプレイヤーから戻る・話数を移る時。URL のサーバーを読み替えないため） */
let reopening: PlayerSession | null = null;
/** URL から作った指定が、同じ物を指しているか（サーバー以外で比べる） */
const sameTarget = (a: PlayerSession, b: PlayerSession) => a.kind === b.kind
  && (a.kind === 'watch' && b.kind === 'watch' ? a.params.id === b.params.id
    : a.kind === 'live' && b.kind === 'live' && a.params.sid === b.params.sid && a.params.onid === b.params.onid);

/** 別の話数などへ: 見ている間は画面ごと、隠れている間は画面を動かさずに（元と同じ） */
function goWatch(p: WatchParams, active: boolean) {
  if (active) { reopening = { kind: 'watch', params: p }; router.replace({ pathname: '/watch/[id]', params: { ...p } }); }
  else miniPlayer.setSession({ kind: 'watch', params: p });
}

/** 再生画面から前の画面へ（再生画面の戻るボタンと同じ） */
const backFrom = (s: PlayerSession) => (router.canGoBack() ? router.back() : router.replace(s.kind === 'watch' ? '/' : '/epg'));

/** ミニプレイヤーから再生画面へ戻る */
export function openPlayer(s: PlayerSession) {
  reopening = s;
  if (s.kind === 'watch') router.push({ pathname: '/watch/[id]', params: { ...s.params } });
  else router.push({ pathname: '/live', params: { ...s.params } });
}

function LiveSession({ params, active, band }: { params: LiveParams; active: boolean; band: boolean }) {
  const { t: tx } = useT();
  const api = useApi();
  const node = params.node ?? null;
  const channels = useQuery({ queryKey: ['live', 'channels', node ?? ''], queryFn: () => api.live.channels(node) });
  const back = () => backFrom({ kind: 'live', params });
  const ch = channels.data ? resolveLiveChannel(channels.data, Number(params.sid), Number(params.onid)) : null;
  if (ch) return <LivePlayer channel={ch} node={node} onBack={back} active={active} band={band} />;
  return (
    <LiveMessage loading={channels.isLoading}
      error={channels.error ? tx('shell.playerHost.couldntGetChannelList', { v0: channels.error.message })
        : channels.data ? tx('shell.playerHost.channelCantWatchedLive') : null} />
  );
}

const styles = StyleSheet.create({
  // 見えないが描き続ける（作り直すと再生が途切れるため）
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  anchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
});
