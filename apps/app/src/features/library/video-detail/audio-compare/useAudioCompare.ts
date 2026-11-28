import {
  addedLabel, pickDefaultCandidate, sourceHas, type AddedTracks, type CompareCandidate, type CompareJob, type SyncRecord, type Video,
} from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 字幕・実況の取り込みの状態と操作: 比べる相手の候補、解析（2秒ごとに追う）、前回の時間の対応で取り込む、
 * 取り込んだトラックを消す。解析中に閉じても、開き直すと動いている（順番待ちの）解析の続きを追う
 */
export function useAudioCompare(video: Video, onApplied: () => void) {
  const { t: tx } = useT();
  const api = useApi();
  const [cands, setCands] = useState<{ videos?: CompareCandidate[]; recordings?: CompareCandidate[] } | null>(null);
  const [sel, setSel] = useState<CompareCandidate | null>(null);
  const [path, setPath] = useState('');
  const [job, setJob] = useState<CompareJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [capOn, setCapOn] = useState(true);
  const [cmtOn, setCmtOn] = useState(true);
  const [tracks, setTracks] = useState<AddedTracks | null>(null);
  const [records, setRecords] = useState<SyncRecord[]>([]);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTracks = () => {
    api.audioCompare.addedTracks(video.id).then(setTracks).catch(() => {});
    api.audioCompare.syncRecords(video.id).then(setRecords).catch(() => setRecords([]));
  };
  const follow = (jobId: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const j = await api.audioCompare.job(jobId);
        setJob(j);
        // 順番待ちの間も追う（止めると、終わっても取り込まれていないように見える）
        if (j.state !== 'running' && j.state !== 'queued') {
          clearInterval(poll.current!);
          poll.current = null;
          setBusy(false);
          const a = j.result?.added;
          if (j.state === 'done' && (a?.captions || a?.comments)) { setMsg(tx('library.useAudioCompare.imported', { v0: addedLabel(a) })); loadTracks(); onApplied(); }
        }
      } catch { clearInterval(poll.current!); poll.current = null; setBusy(false); }
    }, 2000);
  };
  useEffect(() => {
    // 動いている（順番待ちの）解析だけ引き継ぐ。終わったものまで戻すと入力が隠れたままになる
    api.audioCompare.current(video.id).then((r) => {
      const j = r?.job;
      if (!j || (j.state !== 'running' && j.state !== 'queued')) return;
      setJob(j);
      setBusy(true);
      follow(j.id);
    }).catch(() => {});
    api.audioCompare.candidates(video.id).then((c) => { setCands(c); setSel(pickDefaultCandidate(c)); })
      .catch((e: Error) => setMsg(e.message || tx('library.useAudioCompare.couldntGetCandidates')));
    loadTracks();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [video.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const has = sourceHas(sel);
  const canRun = (has.caption && capOn) || (has.comment && cmtOn);
  const target = () => (sel ? (sel.kind === 'video' ? { video_id: sel.id } : { recording_id: sel.id }) : path.trim() ? { path: path.trim() } : null);
  const kinds = () => ({ captions: has.caption && capOn ? { mode: 'new' } : null, comments: has.comment && cmtOn ? { mode: 'new' } : null });
  const runFull = async (audioOnly: boolean) => {
    const t = target();
    if (!t) { setMsg(tx('library.useAudioCompare.chooseSourceCompare')); return; }
    setBusy(true);
    setMsg('');
    setJob(null);
    try { follow((await api.audioCompare.startFull(video.id, { ...t, audio_only: audioOnly || undefined, ...kinds() })).job_id); } catch (e) {
      setMsg(e instanceof Error ? e.message : tx('common.couldntStart'));
      setBusy(false);
    }
  };
  // 同じ相手で前に解析していれば、その時間の対応をそのまま使う（解析の3分を省ける）
  const applyRecord = async (rec: SyncRecord) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.audioCompare.apply(video.id, {
        source: { video_id: rec.source?.video_id }, ranges: (rec.ranges ?? []).map((x) => [x.b_start, x.b_end, x.offset]),
        detail: rec.ranges, video_check: [], method: rec.method || 'audio_xcorr',
        captions: capOn ? { mode: 'new' } : null, comments: cmtOn ? { mode: 'new' } : null,
      });
      setMsg(tx('library.useAudioCompare.importedPreviousResult', { v0: addedLabel(r.added) }));
      loadTracks();
      onApplied();
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('library.useAudioCompare.importFailed')); } finally { setBusy(false); }
  };
  const delTrack = async (body: { caption_index?: number; comment_key?: string }, label: string) => {
    setBusy(true);
    setMsg('');
    try { setTracks(await api.audioCompare.deleteTrack(video.id, body)); setMsg(tx('library.useAudioCompare.deleted', { v0: label })); onApplied(); } catch (e) {
      setMsg(e instanceof Error ? e.message : tx('common.deleteFailed'));
    } finally { setBusy(false); }
  };

  return {
    cands, sel, setSel, path, setPath, job, setJob, busy, msg, setMsg, capOn, setCapOn, cmtOn, setCmtOn, tracks, records,
    has, canRun, runFull, applyRecord, delTrack,
  };
}

export type AudioCompare = ReturnType<typeof useAudioCompare>;
