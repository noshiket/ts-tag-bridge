import { fmtMs, type CmJob, type CmMarkDecl, type CmResult, type SegChapter } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useT } from '../../../ui/i18n/I18n';

/**
 * CM解析の結果（録画登録スキャンが作る参考表示）と、分割に当てたチャプター（サーバー導出）を取る（元の split.jsx の取得と同じ）。
 * 走っている間は10秒ごとに見に行く。取得に失敗しただけの時は前の結果を消さずに取り直す
 */
export function useCmAnalysis(dbRecId: number, node: string | null, indexedSegments: () => (string | null)[], editKey: string) {
  const { t: tx } = useT();
  const api = useApi();
  const [cm, setCm] = useState<CmResult | null>(null);
  const [job, setJob] = useState<CmJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState('');
  useEffect(() => { setCm(null); setJob(null); setError(null); }, [dbRecId, node]);
  useEffect(() => {
    let alive = true;
    void api.recordings.cmAnalysisStatus(dbRecId, node).then((r) => {
      if (!alive) return;
      if (r.fetchFailed) { setTimeout(() => { if (alive) setTick((v) => v + 1); }, 5000); return; }
      setCm(r.ready ? r.result ?? null : null);
      setJob(r.job ?? null);
      setError((!r.ready && r.error) || null);
      if (r.job && (r.job.state === 'queued' || r.job.state === 'running')) setTimeout(() => { if (alive) setTick((v) => v + 1); }, 10000);
    });
    return () => { alive = false; };
  }, [api, dbRecId, node, tick]);

  const start = () => {
    setJob({ state: 'queued' });
    api.recordings.cmAnalysis(dbRecId, node).then(() => setTick((v) => v + 1))
      .catch((e: unknown) => setJob({ state: 'error', error: e instanceof Error ? e.message : tx('split.useCmAnalysis.couldntStart') }));
  };
  // CM解析のアドオン（有効なもの）と、それが名乗る印の出し方。画面はアドオンの名前も鍵も知らず、これで描く
  const cmAddons = useQuery({
    queryKey: ['addons', node ?? '', 'cm_analysis'],
    queryFn: async () => (await api.autoAdd.addons('cm_analysis', node)).filter((a) => !a.error),
    staleTime: 60_000,
  });
  const decls: CmMarkDecl[] = (cmAddons.data ?? []).flatMap((a) => a.marks ?? []);
  const addonLabels = (cmAddons.data ?? []).map((a) => a.label || a.name);
  // 解析はやり直さず、アドオンだけ掛け直す（自分で TS を読むものは数十秒〜数分）
  const rerunAddons = () => {
    if (addonBusy) return;
    setAddonBusy(true); setAddonMsg('');
    api.recordings.rerunCmAddons(dbRecId, node)
      .then((r) => { const a = r.after ?? {}; setAddonMsg(decls.map((d) => tx('common.labelCount', { v0: d.label, v1: a[d.key] ?? 0 })).join(' / ') || tx('split.useCmAnalysis.reRan')); setTick((v) => v + 1); })
      .catch((e: unknown) => setAddonMsg(tx('common.failed', { v0: e instanceof Error ? e.message : String(e) })))
      .finally(() => setAddonBusy(false));
  };

  // 話ごとのチャプター（エンコード時に書く chapter.txt と同じ処理でサーバーが導出）。トリムを動かすたびに叩かないよう少し待つ
  const [segChapters, setSegChapters] = useState<SegChapter[][]>([]);
  useEffect(() => {
    if (!cm) { setSegChapters([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.recordings.chapters(dbRecId, indexedSegments(), node).then((r) => { if (alive) setSegChapters(r.chapters ?? []); }).catch(() => { if (alive) setSegChapters([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [api, dbRecId, node, cm, editKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 入力タイムラインの名前は「解析の残す区間」で引く
  const [inputChapters, setInputChapters] = useState<SegChapter[]>([]);
  useEffect(() => {
    const trims = cm?.trim_segments ?? [];
    if (!trims.length) { setInputChapters([]); return; }
    let alive = true;
    const seg = `full,${trims.map((t) => `keep(${fmtMs(t.start)}-${fmtMs(t.end)})`).join(',')}`;
    api.recordings.chapters(dbRecId, [seg], node).then((r) => { if (alive) setInputChapters(r.chapters?.[0] ?? []); }).catch(() => { if (alive) setInputChapters([]); });
    return () => { alive = false; };
  }, [api, dbRecId, node, cm]);
  return { cm, job, error, start, rerunAddons, addonBusy, addonMsg, segChapters, inputChapters, decls, addonLabels };
}

export type CmAnalysis = ReturnType<typeof useCmAnalysis>;
