import { addonReservePayload, findAddonReserve, findReserve, isAddonEvent, pendingFromEvent, programStatus, type EpgEvent } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';

import type { EpgData } from './useEpgData';
import { openNewAutoAdd } from '../../autoadd/pending';
import { AddonReserveSheet } from '../AddonReserveSheet';
import { ProgramSheet } from '../ProgramSheet';
import { useT } from '../../../ui/i18n/I18n';

/** 今放送している番組か */
const isAiringNow = (e: { start_time: string; duration_sec: number }, now = Date.now()) => {
  const st = Date.parse(e.start_time);
  return st <= now && now < st + e.duration_sec * 1000;
};

/**
 * 押した番組のシート。EDCB の番組は予約・スキップ・自動予約・放送中ならライブ。
 * 番組表のアドオンの番組は録画アドオンへ予約（項目があれば入力してから）とアドオンの頁を開く
 */
export function EpgProgramSheets({ d, tapped, setTapped }: { d: EpgData; tapped: EpgEvent | null; setTapped: (e: EpgEvent | null) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { viewNode, recorder, maps } = d;
  const { t: tx } = useT();
  const reserves = d.reserves.data ?? [];
  const refreshReserves = () => qc.invalidateQueries({ queryKey: ['reserves', viewNode ?? ''] });
  const tAddon = isAddonEvent(tapped) ? tapped : null;
  const tRes = tapped ? (tAddon ? findAddonReserve(reserves, tAddon) : findReserve(reserves, tapped)) : undefined;
  // 録画アドオンへ予約する（予約は本体の予約一覧に入る。extra は予約フォームの値）
  const [reserveFor, setReserveFor] = useState<typeof tAddon>(null);
  const reserveViaAddon = async (e: NonNullable<typeof tAddon>, extra: Record<string, unknown> = {}) => {
    if (!recorder.data) return;
    try {
      const r = await api.autoAdd.fire<{ ok?: boolean; message?: string }>(recorder.data.name, { event: 'reserve', payload: addonReservePayload(e, extra) }, viewNode);
      if (r.ok === false || r.result?.ok === false) Alert.alert(tx('epg.reserveFailed'), r.result?.message || '');
    } catch (err) { Alert.alert(tx('epg.reserveFailed'), err instanceof Error ? err.message : String(err)); }
    setReserveFor(null);
    void refreshReserves();
  };
  const tStatus = tapped ? programStatus(maps, tapped) : undefined;
  const close = () => setTapped(null);
  const act = async (fn: () => Promise<unknown>) => { close(); try { await fn(); } finally { void refreshReserves(); } };
  const openReserve = tRes ? () => { close(); router.push({ pathname: '/reserve/[id]', params: { id: tRes.reserve_id } }); } : undefined;

  return (
    <>
      {tAddon ? (
        // 番組表のアドオンの番組: EDCB の番組ではないので、EDCB の予約・スキップ・自動予約・ライブは出さない（元と同じ）
        <ProgramSheet e={tAddon} node={viewNode} status={tStatus} force={undefined} station={tAddon.addon.chName} fetchDetail={false}
          onClose={close}
          reserveLabel={tx('epg.addonReserve')}
          // 局に live_url があり、録画アドオンが居る時だけ予約できる
          onReserve={!tRes && recorder.data && tAddon.addon.liveUrl ? () => {
            const e = tAddon;
            close();
            // 項目を持つ録画アドオンなら入力してから、無ければそのまま予約する
            if (recorder.data?.params?.length) setReserveFor(e); else void reserveViaAddon(e);
          } : undefined}
          openUrl={tAddon.addon.url ? { label: tx('epg.openIn', { name: d.guideLabel ?? '' }), onPress: () => { void Linking.openURL(tAddon.addon.url!); } } : undefined}
          onOpenReserve={openReserve} />
      ) : (
        <ProgramSheet e={tapped} node={viewNode} status={tStatus} force={tapped ? d.forces.data?.[`${tapped.onid}-${tapped.sid}`] : undefined}
          station={tapped ? d.channels.find((c) => c.onid === tapped.onid && c.sid === tapped.sid)?.name : undefined}
          onClose={close}
          onReserve={tRes ? undefined : () => void act(() => api.epg.reserve(tapped!, 1, viewNode))}
          // 予約があればその予約をスキップ、無ければスキップとして予約を入れる
          onSkip={tRes?.rec_enabled === 0 ? undefined : () => void act(() => (tRes ? api.reserves.skip(tRes.reserve_id, viewNode) : api.epg.reserve(tapped!, 0, viewNode)))}
          onUnskip={tRes?.rec_enabled === 0 ? () => void act(() => api.reserves.unskip(tRes.reserve_id, viewNode)) : undefined}
          onOpenReserve={openReserve}
          onAutoAdd={tapped ? () => { close(); openNewAutoAdd(pendingFromEvent(tapped), viewNode); } : undefined}
          // 放送中の番組だけ: ライブで見る（元と同じ）
          onWatchLive={tapped && isAiringNow(tapped) ? () => { close(); router.push({ pathname: '/live', params: { sid: tapped.sid, onid: tapped.onid } }); } : undefined} />
      )}
      <AddonReserveSheet recorder={recorder.data ?? null} e={reserveFor} node={viewNode}
        onSubmit={(extra) => (reserveFor ? reserveViaAddon(reserveFor, extra) : Promise.resolve())} onClose={() => setReserveFor(null)} />
    </>
  );
}
