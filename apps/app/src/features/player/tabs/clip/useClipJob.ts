import type { AddonRunJob } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useEffect, useState } from 'react';

import { downloadAndShare } from '../../../../lib/device/downloadShare';
import { useT } from '../../../../ui/i18n/I18n';

type ClipResult = { file?: string; download_name?: string; size?: number };

// 実行中/直近の切り抜きを動画ごとに覚えておく。切り出しはサーバー側の仕事として走り続けるので、
// タブを離れて戻った時に進捗と結果を出し直せるようにする
const clipJobs: Record<number, { jobId?: string; job?: AddonRunJob | null; inT?: number | null; outT?: number | null }> = {};

/**
 * 切り抜きの範囲（IN/OUT。タブを離れても覚える）と、切り出しの仕事（1秒ごとに追う。戻ってきたら続きを追う）、
 * できたファイルの受け取り（Web は応答を確かめてから保存、iOS は落としてから共有シート）
 */
export function useClipJob(videoId: number, node: string | null) {
  const { t: tx } = useT();
  const api = useApi();
  const saved = clipJobs[videoId] ?? {};
  const [inT, setInT] = useState<number | null>(saved.inT ?? null);
  const [outT, setOutT] = useState<number | null>(saved.outT ?? null);
  const [job, setJob] = useState<AddonRunJob | null>(saved.job ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { clipJobs[videoId] = { ...clipJobs[videoId], inT, outT }; }, [videoId, inT, outT]);

  const followJob = useCallback(async (jobId: string) => {
    setBusy(true);
    try {
      for (let i = 0; i < 7200; i++) {
        const j = await api.videoActions.addonJob(jobId, node);
        clipJobs[videoId] = { ...clipJobs[videoId], jobId, job: j };
        setJob(j);
        if (j.state === 'done' || j.state === 'error') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('player.useClipJob.couldntGetStatus')); } finally { setBusy(false); }
  }, [api, videoId, node]);
  useEffect(() => {
    const st = clipJobs[videoId];
    if (st?.jobId && (!st.job || (st.job.state !== 'done' && st.job.state !== 'error'))) void followJob(st.jobId);
  }, [videoId, followJob]);

  const canRun = !busy && inT != null && outT != null && outT > inT;
  const run = async (addonName: string, params: Record<string, unknown>) => {
    if (!canRun) return;
    setMsg(null); setJob(null);
    try {
      const { job_id } = await api.videoActions.runAddon(videoId, addonName, params, node);
      clipJobs[videoId] = { ...clipJobs[videoId], jobId: job_id, job: null };
      await followJob(job_id);
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('player.useClipJob.cuttingFailed')); }
  };

  const result = job?.state === 'done' ? (job.result as ClipResult | undefined) : undefined;
  const dlUrl = result?.file && job?.addon
    ? api.videoActions.addonFileUrl(job.addon, result.file, result.download_name || result.file, node) : null;
  const saveNative = async () => {
    if (!dlUrl || !result || saving) return;
    setMsg(null); setSaving(true);
    const err = await downloadAndShare(dlUrl, api.client.authHeaders(), result.download_name || result.file || 'clip.mp4');
    setSaving(false);
    if (err) setMsg(err);
  };
  // 失敗時にエラーの JSON をそのまま保存させないよう、応答を確かめてから保存させる（元と同じ）
  const download = async () => {
    if (!dlUrl || !result) return;
    setMsg(null);
    try {
      const res = await fetch(dlUrl, { headers: api.client.authHeaders() });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(e.error || tx('player.useClipJob.couldntDownload', { v0: res.status }));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = result.download_name || result.file!;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setMsg(e instanceof Error ? e.message : tx('player.useClipJob.downloadFailed')); }
  };

  return { inT, setInT, outT, setOutT, job, busy, msg, canRun, run, result, dlUrl, saving, saveNative, download };
}

export type ClipJob = ReturnType<typeof useClipJob>;
