import type { MsgKey } from '@tstag/core';
import {
  bandOfOnid, buildAddonGuide, channelOf, groupChannels, guideDates, guideNameOf, reserveMaps, todayAt4, weekOptions,
  type Band, type EpgEvent, type VideoAddonParam,
} from '@tstag/core';
import { useApi, useEpgEvents, useJikkyoForces, useLogoSet, useReserves, useServices } from '@tstag/core/react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppActive } from '../../../lib/lifecycle/appActive';
import { deviceStore } from '../../../lib/device/deviceStore';
import { useViewNode } from '../../../lib/state/viewNode';

/** 最後に見ていた所（端末ごと。画面の大きさで意味が変わるのでアカウントには置かない。元と同じ名前） */
const POS_KEY = 'tstag_epg_pos';
const loadPos = (): { band?: string; day?: number; ch?: string } => { try { return JSON.parse(deviceStore.get(POS_KEY) || '{}'); } catch { return {}; } };
export const BANDS: [Band, MsgKey][] = [['terr', 'common.terrestrial'], ['bs', 'epg.band.bs'], ['cs', 'epg.band.cs']];

/**
 * 番組表の見る所（帯・日・局。端末に覚える）と中身: 局・ロゴ・実況の勢い・予約、
 * 番組表のアドオン（target='guide'）の局と番組、配信の番組を録画できるアドオン（records_guide）。
 * Grid は帯の全部の局、List / Week は選んでいる局だけ読む（元と同じ）
 */
export function useEpgData(view: 'grid' | 'list' | 'week') {
  const api = useApi();
  const { viewNode } = useViewNode();
  const saved = useRef(loadPos()).current;
  const days = useMemo(() => weekOptions(), []);
  // 地デジ/BS/CS か、番組表のアドオン（addon:<名前>）
  const [band, setBand] = useState<string>(saved.band ?? 'terr');
  const guideName = guideNameOf(band);
  const [day, setDay] = useState(() => (saved.day && days.some((d) => d.ms === saved.day) ? saved.day : todayAt4()));
  const [activeCh, setActiveCh] = useState<string | null>(saved.ch ?? null);

  const guideAddons = useQuery({ queryKey: ['addons', viewNode ?? '', 'guide'], queryFn: async () => (await api.autoAdd.addons('guide', viewNode)).filter((a) => !a.error) });
  const recorder = useQuery({
    queryKey: ['addons', viewNode ?? '', 'recorder'],
    queryFn: async () => ((await api.autoAdd.addons('event', viewNode)).find((a) => a.records_guide) ?? null) as ({ name: string; label?: string; params?: VideoAddonParam[] } | null),
  });
  const guideLabel = guideName ? guideAddons.data?.find((a) => a.name === guideName)?.label || guideName : null;
  // アドオンの編成は暦日で返る。表示の1日は朝4時から翌朝4時なので1日多く取る（Week は8日+1。元と同じ）
  const guideDays = useQueries({
    queries: guideName ? guideDates(view === 'week' ? days[0]!.ms : day, view === 'week' ? days.length : 1).map((date) => ({
      queryKey: ['addonGuide', viewNode ?? '', guideName, date],
      queryFn: () => api.autoAdd.guide(guideName, date, viewNode).catch(() => null),
      staleTime: 5 * 60_000,
    })) : [],
  });
  const guideData = guideDays.map((q) => q.data);
  const guide = useMemo(() => (guideName ? buildAddonGuide(guideName, guideData) : null), [guideName, JSON.stringify(guideDays.map((q) => q.dataUpdatedAt))]); // eslint-disable-line react-hooks/exhaustive-deps
  const services = useServices(viewNode);
  const logos = useLogoSet();
  const forces = useJikkyoForces(viewNode);
  const reserves = useReserves(viewNode);
  const channels = useMemo(() => (services.data ?? []).map(channelOf), [services.data]);
  const bands = useMemo(() => (channels.length ? new Set(channels.map((c) => bandOfOnid(c.onid))) : new Set<Band>(['terr', 'bs', 'cs'])), [channels]);
  const groups = useMemo(() => (guide ? guide.channels : groupChannels(channels.filter((c) => bandOfOnid(c.onid) === band))), [channels, band, guide]);
  const activeGroup = groups.find((g) => g.id === activeCh);
  const loadGroups = useMemo(() => (guide ? [] : view === 'grid' ? groups : activeGroup ? [activeGroup] : []), [guide, view, groups, activeGroup]);
  const edcbEvents = useEpgEvents(loadGroups, viewNode);
  // アドオンの番組表はアドオンが返した番組、それ以外は EDCB の番組
  const events = guide ? { byId: guide.byId as Map<string, EpgEvent[]>, loading: guideDays.some((q) => q.isLoading) } : edcbEvents;
  const maps = useMemo(() => reserveMaps(reserves.data ?? []), [reserves.data]);
  const [now, setNow] = useState(() => Date.now());
  // 前にいる間だけ（背面で番組表を丸ごと描き直すと、小窓の間に画面の処理が詰まった）。戻ったらすぐ合わせる
  const appActive = useAppActive();
  useEffect(() => { if (!appActive) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, [appActive]);

  // 局の無い帯は出さず、選んでいる帯に局が無くなったら最初の帯へ。選んでいる局が無ければ先頭の局
  useEffect(() => {
    if (!guideName && channels.length && !bands.has(band as Band)) { const first = BANDS.find(([b]) => bands.has(b)); if (first) setBand(first[0]); }
    // 前に見ていたアドオンの番組表が無くなっていたら（無効化・削除）地デジへ戻す（元と同じ）
    if (guideName && guideAddons.data && !guideAddons.data.some((a) => a.name === guideName)) setBand('terr');
  }, [channels.length, bands, band, guideName, guideAddons.data]);
  useEffect(() => {
    if (groups.length && !groups.some((g) => g.id === activeCh)) setActiveCh(groups[0]!.id);
  }, [groups, activeCh]);
  useEffect(() => { deviceStore.set(POS_KEY, JSON.stringify({ ...loadPos(), band, ch: activeCh, day })); }, [band, activeCh, day]);
  const loading = (guide ? false : services.isLoading) || events.loading;

  return {
    viewNode, days, band, setBand, guideName, guideLabel, day, setDay, activeCh, setActiveCh, guideAddons, recorder,
    logos, forces, reserves, channels, bands, groups, activeGroup, events, maps, now, loading,
  };
}

export type EpgData = ReturnType<typeof useEpgData>;
