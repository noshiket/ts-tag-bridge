import type { LiveChannel, LiveComment, LiveStatus } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { CaptureOptions, CaptureResult } from '../../player/tabs/CaptureTab';
import { isAppActive } from '../../../lib/lifecycle/appActive';
import type { LiveEvent, LiveSurfaceHandle } from '../surface';
import { useT } from '../../../ui/i18n/I18n';

/** 実況の一覧に持つ数（元と同じ 500） */
const MAX_COMMENTS = 500;

/**
 * プレイヤーのページから届く知らせ（状態・バッファ・エラー・実況・通知・小窓）と、
 * 答えを待つ命令（コメントを送る・撮る）。局・画質を変えたら一覧と通知を空にする（元と同じ）
 */
export function useLiveEvents(surface: RefObject<LiveSurfaceHandle | null>, channel: LiveChannel, quality: string, appActive: boolean) {
  const { t: tx } = useT();
  const api = useApi();
  const channelId = channel.display_channel_id;
  const [status, setStatus] = useState<LiveStatus>({ status: 'Offline', detail: tx('live.useLiveEvents.connecting') });
  const [st, setSt] = useState({ paused: false, buffering: false, bufferSec: 0 });
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  // 送った・撮った結果を待つ
  const waiters = useRef(new Map<number, (e: LiveEvent) => void>());
  const seq = useRef(1);
  const ask = <R,>(make: (id: number) => Parameters<LiveSurfaceHandle['command']>[0]) => new Promise<R>((resolve) => {
    const id = seq.current++;
    waiters.current.set(id, resolve as (e: LiveEvent) => void);
    surface.current?.command(make(id));
  });

  const pendingComments = useRef<LiveComment[]>([]);
  const flushComments = useCallback(() => {
    const add = pendingComments.current;
    if (!add.length) return;
    pendingComments.current = [];
    setComments((prev) => { const next = [...prev, ...add]; return next.length > MAX_COMMENTS ? next.slice(next.length - MAX_COMMENTS) : next; });
  }, []);
  useEffect(() => { if (appActive) flushComments(); }, [appActive, flushComments]);
  const onEvent = useCallback((e: LiveEvent) => {
    switch (e.type) {
      case 'status': setStatus(e.status); break;
      case 'state': setSt({ paused: e.paused, buffering: e.buffering, bufferSec: e.bufferSec }); break;
      case 'error': setError(e.message); break;
      case 'comment':
        // 背面の間は溜めておき、前に戻った時にまとめて一覧へ足す
        pendingComments.current.push(e.comment);
        if (isAppActive()) flushComments();
        break;
      case 'notice': setNotice(e.message); break;
      case 'pip': setPipActive(e.active); break;
      case 'pipSupported': setPipSupported(e.supported); break;
      case 'commentSupported': setSupported(e.supported); if (e.notice) setNotice(e.notice); break;
      case 'sent': case 'captured': { const w = waiters.current.get(e.id); waiters.current.delete(e.id); w?.(e); break; }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pendingComments.current = []; setComments([]); setNotice(null); }, [channelId, quality]);

  const sendComment = async (text: string) => {
    if (!text.trim()) return { ok: false };
    const r = await ask<Extract<LiveEvent, { type: 'sent' }>>((id) => ({ type: 'send', id, text }));
    if (!r.ok) setNotice(r.error ?? tx('live.useLiveEvents.couldntSendComment'));
    return { ok: r.ok };
  };
  const capture = async (o: CaptureOptions): Promise<CaptureResult> => {
    const r = await ask<Extract<LiveEvent, { type: 'captured' }>>((id) => ({ type: 'capture', id, ...o }));
    if (!r.ok || !r.image) return { ok: false, error: r.error ?? tx('live.useLiveEvents.couldntCapture') };
    try {
      const j = await api.stream.saveCapture({ image: r.image, station: channel.service_name || channelId, channel_id: channelId, tot: null });
      return j.ok && j.file ? { ok: true, file: j.file } : { ok: false, error: j.error || tx('common.saveFailed2') };
    } catch { return { ok: false, error: tx('common.saveRequestFailed') }; }
  };

  return { status, st, error, comments, notice, supported, pipSupported, pipActive, setPipActive, onEvent, sendComment, capture };
}
