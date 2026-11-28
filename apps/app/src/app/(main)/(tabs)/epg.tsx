import { inWindow, todayAt4, type AddonChannel, type EpgEvent } from '@tstag/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChannelHeader, DayHeader } from '../../../features/epg/ChannelHeader';
import { EpgGrid, HOURS, type EpgGridHandle, type GridColumn } from '../../../features/epg/EpgGrid';
import { EpgList } from '../../../features/epg/EpgList';
import { ChannelTabs } from '../../../features/epg/screen/ChannelTabs';
import { EpgBandBar, EpgTopRight } from '../../../features/epg/screen/EpgControls';
import { EpgProgramSheets } from '../../../features/epg/screen/EpgProgramSheets';
import { useEpgData } from '../../../features/epg/screen/useEpgData';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT, localizeFmt } from '../../../ui/i18n/I18n';

const PX_PER_HOUR = 200;
/** 列の幅（Grid は局、Week は日。元と同じ） */
const COL_WIDTH = 144;
const WEEK_COL_WIDTH = 120;

/**
 * 番組表（元の epg.jsx）。Grid（局を横に並べる）・List（選んだ局のその日）・Week（選んだ局の8日）。
 * つまむと拡大縮小（番組の所は縦横とも、時刻の列は時間の軸だけ）。PC の幅では −/＋ も出す（元と同じ）。
 * 右上の 🔍 で番組検索へ。
 * 番組表のアドオン（target='guide'）は地デジ/BS/CS の隣にタブを足す。画面はアドオンの名前を知らず、
 * アドオンが名乗る label と返した局・番組、録画アドオン（records_guide）の params だけで組む。
 * 中身は features/epg/screen（読む物は useEpgData、押した番組は EpgProgramSheets）
 */
export default function EpgScreen() {
  useBgRenderCount('EPG');
  const { theme, epgView: view } = useTheme();
  const { t: tx } = useT();
  const d = useEpgData(view);
  const { groups, activeGroup, events, day, days, loading } = d;
  const [tapped, setTapped] = useState<EpgEvent | null>(null);
  const grid = useRef<EpgGridHandle>(null);
  // 拡大縮小（scale は縦横とも、vZoom は時間の軸だけ）
  const [scale, setScale] = useState(1);
  const [vZoom, setVZoom] = useState(1);
  const pxPerHour = Math.round(PX_PER_HOUR * scale * vZoom);
  const colBase = view === 'week' ? WEEK_COL_WIDTH : COL_WIDTH;
  const colWidth = Math.round(colBase * scale);
  const isPC = useWindowDimensions().width >= 900;

  const columns = useMemo((): GridColumn[] => {
    const subsOf = (g: (typeof groups)[number]) => g.subChannels.map((c) => events.byId.get(c.id) ?? []);
    if (view === 'week') {
      if (!activeGroup) return [];
      const subs = subsOf(activeGroup);
      return days.map((x) => ({ key: String(x.ms), header: <DayHeader label={localizeFmt(x.label.split(' ')[0]!)} />, start: x.ms, subs }));
    }
    return groups.map((g) => ({
      key: g.id, start: day, subs: subsOf(g),
      header: <ChannelHeader g={g} hasLogo={!!d.logos.data?.has(`${g.onid}-${g.sid}`)} width={colWidth} logoUrl={(g as Partial<AddonChannel>).logoUrl} />,
    }));
  }, [view, groups, activeGroup, events.byId, day, days, d.logos.data, colWidth]);
  // List は選んでいる局（の代表のサブチャンネル）のその日
  const listEvents = useMemo(() => (activeGroup ? (events.byId.get(activeGroup.id) ?? []).filter((e) => inWindow(e, day)) : []), [activeGroup, events.byId, day]);

  // 読み終えたら今の時刻のあたりへ（今日を見ている時だけ）
  useEffect(() => {
    if (loading || view === 'list') return;
    // Week は今日の列で見る
    const top = ((Date.now() - (view === 'week' ? todayAt4() : day)) / 3_600_000) * pxPerHour;
    if (top >= 0 && top <= HOURS * pxPerHour) setTimeout(() => grid.current?.scrollToY(Math.max(0, top - 200)), 0);
    // 大きさを変えた時は動かさない
  }, [loading, day, d.band, view]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <TopBar title={tx('title.epg')} right={<EpgTopRight isPC={isPC} scale={scale} setScale={setScale} />} />
      <EpgBandBar d={d} />
      <ChannelTabs d={d} onPick={(i) => { if (view === 'grid') grid.current?.scrollToColumn(i); }} />
      <View style={[styles.gridWrap, view === 'list' && styles.listWrap]}>
        {loading ? <T mono size={11} dim style={styles.loading}>Loading EPG...</T> : view === 'list' ? (
          activeGroup && <EpgList events={listEvents} short={activeGroup.short} hue={activeGroup.hue} now={d.now} maps={d.maps} forces={d.forces.data} onPress={setTapped} />
        ) : (
          <EpgGrid ref={grid} columns={columns} now={d.now} pxPerHour={pxPerHour} colWidth={colWidth}
            zoom={{ scale, vZoom, colBase, onChange: (z) => { if (z.scale != null) setScale(z.scale); if (z.vZoom != null) setVZoom(z.vZoom); } }}
            maps={d.maps} forces={d.forces.data} onPress={setTapped} />
        )}
      </View>
      <EpgProgramSheets d={d} tapped={tapped} setTapped={setTapped} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gridWrap: { flex: 1, paddingHorizontal: 12 },
  listWrap: { paddingHorizontal: 0 },
  loading: { textAlign: 'center', paddingVertical: 20 },
});
