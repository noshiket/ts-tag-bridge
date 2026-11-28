import { resumePosition, toTarget, totToPos, watchIdentity, watchEntryFor, type Quality, type StreamMeta, type StreamRef } from '@tstag/core';
import { useApi, useSaveWatch, useStreamMeta, useWatchEntry } from '@tstag/core/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { savedState } from '../../lib/state/savedState';
import type { LocalBundle } from '../../lib/localSave/backend.types';
import { tileReflowed } from '../../lib/localSave/store';
import { dropPending, keepPending, newerEntry, pendingFor } from '../../lib/device/watchPending';
import type { SeekThumbnail } from './SeekBar';

/** 画質と音声（アプリが動いている間は覚えておく。音声のみは覚えない＝次の動画が映像なしで始まらないように） */
const usePlayerPrefs = savedState({ quality: '720p' as Quality });

const newSessionId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

/**
 * 1本の動画を再生する状態: 番組情報・続きの位置・画質と音声・サーバーのセッション・視聴履歴の保存。
 * 元の Web 版の RecordedPlayer の、映像の外側の仕事
 */
/** 始める位置の指定。start: 頭から（次の話数へ送った時）。tot: その放送時刻から（キャプチャの「ここから」） */
export type StartFrom = { start: true } | { tot: string } | null;

/** local: 端末に保存した分（あればそのファイルを再生し、サーバーのセッションは作らない） */
export function usePlayback(target: StreamRef, node: string | null, from: StartFrom = null, local: LocalBundle | null = null) {
  const api = useApi();
  const t = toTarget(target);
  const videoId = t.id;
  // 視聴履歴は動画なら video:<番号>、録画なら recording:<番号>（元と同じ）
  const who = watchIdentity(t, node);
  const meta = useStreamMeta(t, node);
  const entry = useWatchEntry(`${who.type}:${who.id}`);
  const saveWatch = useSaveWatch();
  const [prefs, setPrefs] = usePlayerPrefs();
  const [quality, setQualityState] = useState<Quality>(prefs.quality);
  const [secondaryAudio, setSecondaryAudio] = useState(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  // 画質・音声を変えた時は今の位置から続ける
  const [startAt, setStartAt] = useState<number | null>(null);

  // ローカル保存の再生は、履歴の返事を少しだけ待って始める（通信が無いと返事まで長くかかる）
  const [entryGaveUp, setEntryGaveUp] = useState(false);
  useEffect(() => {
    if (!local) return;
    const t = setTimeout(() => setEntryGaveUp(true), 1500);
    return () => clearTimeout(t);
  }, [local]);

  // 続きの位置（終わり近くまで見ていたら頭から）
  const resume = useMemo(() => {
    // 履歴が引けない時（通信なしでローカル保存を見る時など）は待ちすぎない
    if (!meta.data || (entry.isLoading && entry.failureCount === 0 && !entryGaveUp)) return null;
    // 次の話数へ送った時は頭から（元と同じ）
    if (from && 'start' in from) return 0;
    // キャプチャを撮った位置から（位置へ直せなければ普段どおり続きから）
    if (from && 'tot' in from) {
      const pos = totToPos(meta.data, Date.parse(from.tot));
      if (pos != null) return Math.max(0, pos);
    }
    // サーバーの記録と端末の控え（通信の無い所で見た位置）の新しい方から続ける
    const pos = resumePosition(meta.data, newerEntry(entry.data, pendingFor(`${who.type}:${who.id}`)));
    const dur = meta.data.duration || 0;
    if (pos == null || (dur && (pos >= dur - 30 || pos / dur >= 0.95))) return 0;
    return pos;
  }, [meta.data, entry.isLoading, entry.failureCount, entryGaveUp, entry.data, from]);

  // セッションは画質・音声を変えるたびに作り直す（サーバーのセッションは動画＋画質に付き、
  // 同じ番号で画質を変えると断られる）。切り替える所で新しい番号にする
  const [sessionId, setSessionId] = useState(newSessionId);
  const direct = !!local || (!!meta.data && (meta.data.media_kind === 'audio' || meta.data.streamable === false));
  const source = useMemo(() => {
    if (!meta.data || resume == null) return null;
    if (local) return { uri: local.videoUri };
    const uri = direct
      ? api.stream.mediaUrl(videoId, node)
      : api.stream.playlistUrl(t, quality, sessionId, secondaryAudio, node);
    return { uri, headers: api.client.authHeaders() };
  }, [api, meta.data, resume, direct, videoId, t.kind, quality, sessionId, secondaryAudio, node, local]); // eslint-disable-line react-hooks/exhaustive-deps

  // シークバーのサムネ。iOS は幅の広い旧い画像を読めないので、列を詰め直した画像にする（アプリも iPhone・iPad の Safari も）
  const thumbnail = useMemo<SeekThumbnail | null>(() => {
    // 録画にはシークバーのサムネが無い
    const tile = t.kind === 'vdb' && meta.data?.has_thumbnail_tile ? meta.data.thumbnail_info?.tile : undefined;
    if (!tile) return null;
    // 保存した分は保存したタイル（元の幅のまま）
    if (local) return local.tileUri ? { tile, reflowed: tileReflowed(node), source: { uri: local.tileUri } } : null;
    const reflowed = tileReflowed(node);
    return { tile, reflowed, source: { uri: api.stream.thumbnailTileUrl(videoId, node, reflowed), headers: api.client.authHeaders() } };
  }, [api, meta.data, videoId, node, t.kind, local]);

  // サーバーは 10 秒で使われていないセッションを片付けるので、5 秒ごとに知らせる
  useEffect(() => {
    if (!source || direct) return;
    const iv = setInterval(() => { void api.stream.keepAlive(t, quality, sessionId, node).catch(() => {}); }, 5000);
    return () => clearInterval(iv);
  }, [api, source, direct, videoId, quality, sessionId, node]); // eslint-disable-line react-hooks/exhaustive-deps

  // 視聴履歴: 10 秒ごと・一時停止・画面を離れる・アプリを閉じる時に保存する
  const save = useCallback(() => {
    const m: StreamMeta | undefined = meta.data;
    const pos = positionRef.current;
    if (!m || !(pos > 1)) return;
    const e = watchEntryFor(m, {
      id: who.id, type: who.type, title: m.series_name || m.title, episodeNum: m.episode_number, episodeName: m.episode_name,
    }, pos, m.duration || durationRef.current, newerEntry(entry.data, pendingFor(`${who.type}:${who.id}`)));
    // 先に端末へ控え、サーバーへ届いたら消す（通信の無い所で見た位置も残り、戻ったら送る）
    keepPending(e);
    void saveWatch(e).then(() => dropPending(e)).catch(() => {});
  }, [saveWatch, meta.data, entry.data, who.id, who.type]);
  const lastSave = useRef(0);
  const onTime = useCallback((current: number, duration: number) => {
    positionRef.current = current;
    durationRef.current = duration;
    const now = Date.now();
    if (now - lastSave.current > 10_000) { lastSave.current = now; save(); }
  }, [save]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') save(); });
    return () => { sub.remove(); save(); };
  }, [save]);

  const setQuality = (q: Quality) => {
    setStartAt(positionRef.current);
    setSessionId(newSessionId());
    setQualityState(q);
    if (q !== 'audio') setPrefs({ quality: q });
  };
  /** プレイヤーを作り直す（元の「プレイヤーを再起動」）。今の位置から、配信は新しいセッションで */
  const restart = () => {
    setStartAt(positionRef.current);
    setSessionId(newSessionId());
  };
  const toggleAudio = () => {
    setStartAt(positionRef.current);
    setSessionId(newSessionId());
    setSecondaryAudio((x) => !x);
  };

  return {
    meta, source, direct, thumbnail, quality, setQuality, secondaryAudio, toggleAudio, restart,
    startAt: startAt ?? resume ?? 0,
    onTime, onPaused: save,
  };
}
