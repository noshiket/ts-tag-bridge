import { logoRectToPixels, type AddonRunJob, type AmzLogoAnalyze, type RelRect } from '@tstag/core';
import { useApi, useRecordingProbe } from '@tstag/core/react';
import { useEffect, useMemo, useState } from 'react';

import { logoRectStore, useLogoRect } from '../logoRectStore';
import { useT } from '../../../../ui/i18n/I18n';

const POLL_MS = 1500;

// 解析はサーバー側で走り続けるので、タブを離れて戻っても続きを出せるよう録画ごとに覚えておく
const logoJobs: Record<number, { jobId?: string | null; job?: AddonRunJob | null; rect?: RelRect | null }> = {};

/**
 * ロゴ解析の仕事: 囲んだ範囲を元の TS の画素へ直す・アドオンを走らせて追う（Amatsukaze 側の進みも）・
 * できたロゴを登録/破棄する。解析中は範囲を動かせないようにする
 */
export function useLogoJob(addonName: string, dbRecId: number, node: string | null, params: Record<string, unknown>) {
  const { t: tx } = useT();
  const api = useApi();
  const saved = logoJobs[dbRecId] ?? {};
  const rect = useLogoRect();
  useEffect(() => { if (saved.rect && !logoRectStore.get()) logoRectStore.set(saved.rect); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 座標の基準は TS の符号化画素（再生中の映像は縮小・アスペクト補正された後なので使わない。1440×1080 の放送で 1.33 倍ずれる）
  const probe = useRecordingProbe(dbRecId, node);
  const size = probe.data?.video?.width && probe.data.video.height ? { w: probe.data.video.width, h: probe.data.video.height } : null;
  const px = size && rect && rect.w > 0.001 && rect.h > 0.001 ? logoRectToPixels(rect, size.w, size.h) : null;

  const [job, setJob] = useState<AddonRunJob | null>(saved.job ?? null);
  const [jobId, setJobId] = useState<string | null>(saved.jobId ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [amz, setAmz] = useState<AmzLogoAnalyze | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let dead = false;
    const tick = () => api.videoActions.addonJob(jobId, node).then((j) => {
      if (dead) return;
      setJob(j);
      logoJobs[dbRecId] = { ...logoJobs[dbRecId], jobId, job: j, rect: logoRectStore.get() };
      if (j.state !== 'running') setBusy(false);
    }).catch(() => {});
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { dead = true; clearInterval(t); };
  }, [api, jobId, dbRecId, node]);

  // 解析中は Amatsukaze 側の進み（集めたコマ数・pass）も見る
  const amzJobId = ((job?.result as { job_id?: string } | undefined)?.job_id) ?? null;
  useEffect(() => {
    if (!amzJobId) return;
    const get = () => api.amatsukaze.logoAnalyzeStatus(amzJobId, node).then(setAmz).catch(() => {});
    void get();
    if (job?.state !== 'running') return;
    const t = setInterval(() => void get(), POLL_MS);
    return () => clearInterval(t);
  }, [api, amzJobId, job?.state, node]);

  const running = (busy || job?.state === 'running') && job?.state !== 'error';
  useEffect(() => { logoRectStore.setLocked(running); return () => logoRectStore.setLocked(false); }, [running]);

  const start = () => {
    if (!px) { setMsg(tx('player.useLogoJob.encloseRangeFirst')); return; }
    setBusy(true); setMsg(null); setJob(null); setAmz(null);
    api.recordings.runAddon(dbRecId, addonName, { ...params, rect: px }, node)
      .then((r) => { setJobId(r.job_id); logoJobs[dbRecId] = { jobId: r.job_id, job: null, rect: logoRectStore.get() }; })
      .catch((e: unknown) => { setBusy(false); setMsg(e instanceof Error ? e.message : tx('player.useLogoJob.couldntRun')); });
  };
  const finish = (apply: boolean) => {
    if (!amzJobId) return;
    setBusy(true);
    (apply ? api.amatsukaze.logoAnalyzeApply : api.amatsukaze.logoAnalyzeDiscard)(amzJobId, node)
      .then(() => { setMsg(apply ? tx('player.useLogoJob.logoRegistered') : tx('player.useLogoJob.discarded')); setJob(null); setJobId(null); setAmz(null); delete logoJobs[dbRecId]; })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : tx('common.failed2')))
      .finally(() => setBusy(false));
  };

  const done = job?.state === 'done' && !!amzJobId;
  const imgSrc = useMemo(() => (done && amzJobId ? { uri: api.amatsukaze.logoAnalyzeImageUrl(amzJobId, node), headers: api.client.authHeaders() } : null), [api, done, amzJobId, node]);

  return { size, px, job, busy, msg, amz, running, done, imgSrc, start, finish };
}

export type LogoJob = ReturnType<typeof useLogoJob>;
