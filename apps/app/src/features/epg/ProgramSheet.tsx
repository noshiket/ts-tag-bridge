import { endMs, genreOf, isAddonEvent, programFlags, type EpgEvent } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Plus, Tv } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { ProgramText } from '../../ui/parts/ProgramText';
import { Sheet } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { FLAG_COLOR, forceColor, genreStyle } from './colors';
import { shadow } from '../../ui/theme/edge';
import { trLabel, useT } from '../../ui/i18n/I18n';

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/**
 * 番組表で押した番組（元の EpgSheet / ProgramSheet）: 局・ジャンル・無料/有料・印・予約の状態・実況の勢い、題名と時刻、
 * event ID、説明と詳細（番組表は詳細を落としているので開いた時に1件だけ取る）、映像・音声、予約・スキップ・予約詳細
 */
export function ProgramSheet({ e, station, node, status, force, timeLabel, genre, flags = true, fetchDetail = true, onClose, onReserve, reserveLabel, openUrl, onSkip, onUnskip, onOpenReserve, onAutoAdd, onWatchLive }: {
  e: EpgEvent | null;
  station: string | undefined;
  node: string | null;
  status: 'rec' | 'skip' | undefined;
  force: number | undefined;
  /** 時刻の書き方を変える（番組検索は日付つき） */
  timeLabel?: string;
  /** ジャンルの札を変える（番組検索は検索の色と名前。名前が空なら出さない） */
  genre?: { bg: string; ink: string; label: string };
  /** 字・再などの印を出すか（番組検索は出さない。元と同じ） */
  flags?: boolean;
  /** 詳細を番組表から取り直すか（番組検索の結果は詳細つきなので取らない。元と同じ） */
  fetchDetail?: boolean;
  onClose: () => void;
  onReserve?: () => void;
  /** 予約のボタンの文言（番組表のアドオンの番組は録画アドオンへの予約） */
  reserveLabel?: string;
  /** 番組表のアドオンの番組: そのサービスで開く（文言はアドオンの label から作る） */
  openUrl?: { label: string; onPress: () => void };
  onSkip?: () => void;
  onUnskip?: () => void;
  onOpenReserve?: () => void;
  /** この番組の題名・局で自動予約のルールを作る */
  onAutoAdd?: () => void;
  /** 放送中の番組だけ: ライブで見る */
  onWatchLive?: () => void;
}) {
  const api = useApi();
  const { theme, accent } = useTheme();
  const { t: tx } = useT();
  const full = useQuery({
    queryKey: ['epg', node ?? '', 'event', e ? `${e.onid}-${e.tsid}-${e.sid}-${e.event_id}` : ''],
    queryFn: () => api.epg.event(e!.onid, e!.tsid, e!.sid, e!.event_id, node),
    // 番組表のアドオンの番組は EDCB に無いので取り直さない
    enabled: fetchDetail && !!e && !e.extended_info && !isAddonEvent(e),
  });
  if (!e) return <Sheet open={false} onClose={onClose} title=""><View /></Sheet>;
  const gs = genre ?? genreStyle(genreOf(e.content_nibble), theme);
  const start = Date.parse(e.start_time);
  const ext = e.extended_info || full.data?.extended_info || '';
  const reserved = status === 'rec';
  return (
    // 番組名は中身の見出し（折り返して全部出す）だけにする。シートの見出しにも入れると2回出ていた
    <Sheet open onClose={onClose} title="">
      <ScrollView automaticallyAdjustKeyboardInsets style={styles.scroll}>
        {/* 題名は折り返して全部出す（選んで写せる） */}
        <T range size={15} w={800} style={styles.mb10}>{e.title}</T>
        <View style={styles.badges}>
          {!!station && <Pill bg={theme.surface2} fg={theme.ink} mono>{station}</Pill>}
          {!!gs.label && <Pill bg={gs.bg} fg={gs.ink}>{genre ? gs.label : trLabel(tx, 'epg.genre', genreOf(e.content_nibble), { [genreOf(e.content_nibble)]: gs.label })}</Pill>}
          {e.free_ca != null && <Pill bg={e.free_ca ? oklch(0.82, 0.2, 135) : oklch(0.6, 0.22, 25)} fg="#fff" mono>{e.free_ca ? 'FREE' : tx('epg.paid')}</Pill>}
          {flags && programFlags({ ...e, extended_info: ext }).map((f) => (
            <View key={f} style={[styles.flag, { backgroundColor: FLAG_COLOR[f] }]}><T size={11} w={800} color="#fff">{f}</T></View>
          ))}
          {status && <Pill bg={status === 'skip' ? theme.surface2 : accent.primary} fg={status === 'skip' ? theme.mute : '#fff'} mono>{status === 'skip' ? 'SKIP' : 'REC'}</Pill>}
          {force != null && <Pill bg="rgba(255,150,0,0.1)" fg={forceColor(force)} mono>{tx('epg.force', { n: force })}</Pill>}
        </View>
        <T mono size={12} dim style={styles.mb10}>{timeLabel ?? `${hm(start)} — ${hm(endMs(e))} (${tx('unit.min', { n: Math.round(e.duration_sec / 60) })})`}</T>
        {!isAddonEvent(e) && (
          <View style={[styles.idBox, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.05)' }]}>
            <T mono size={8} dim style={styles.ls}>EVENT ID</T>
            <T range mono size={10} w={700} color={oklch(0.66, 0.27, 350)}>{`${e.onid}-${e.tsid}-${e.sid}-${e.event_id}`}</T>
          </View>
        )}
        {!!e.description && <Box title={tx('epg.description')}><ProgramText text={e.description} size={12} /></Box>}
        {!!ext && <Box title={tx('epg.extended')}><ProgramText text={ext} size={11} /></Box>}
        {!!(e.video_info || e.audio_info) && (
          <View style={styles.av}>
            {!!e.video_info && <Small title={tx('epg.video')} value={e.video_info} />}
            {!!e.audio_info && <Small title={tx('epg.audio')} value={e.audio_info} />}
          </View>
        )}
        <View style={styles.actions}>
          {onReserve && (
            <Pressable onPress={onReserve} disabled={reserved}
              style={[styles.btn, { backgroundColor: reserved ? theme.surface2 : accent.primary, borderColor: theme.frame, boxShadow: reserved ? 'none' : shadow(theme, 3) }]}>
              <T size={12} w={800} color={reserved ? theme.mute : '#fff'}>{reserved ? tx('epg.reserved') : reserveLabel ?? tx('epg.reserve')}</T>
            </Pressable>
          )}
          {openUrl && (
            <Pressable onPress={openUrl.onPress} style={[styles.btn, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
              <T size={12} w={800}>{openUrl.label}</T>
            </Pressable>
          )}
          {onSkip && (
            <Pressable onPress={onSkip} style={[styles.btn, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <T size={12} w={700} dim>{tx('epg.skip')}</T>
            </Pressable>
          )}
          {onUnskip && (
            <Pressable onPress={onUnskip} style={[styles.btn, { backgroundColor: theme.surface2, borderColor: theme.frame }]}>
              <T size={12} w={700}>{tx('epg.unskip')}</T>
            </Pressable>
          )}
          {onWatchLive && (
            <Pressable onPress={onWatchLive} style={[styles.btn, styles.live, { boxShadow: shadow(theme, 3, oklch(0.35, 0.18, 145)) }]}>
              <Tv s={15} c="#fff" />
              <T size={12} w={800} color="#fff">{tx('epg.live')}</T>
            </Pressable>
          )}
          {onOpenReserve && (
            <Pressable onPress={onOpenReserve} style={[styles.btn, { backgroundColor: accent.primary, borderColor: theme.frame }]}>
              <T size={12} w={800} color="#fff">{tx('epg.openReserve')}</T>
            </Pressable>
          )}
          {onAutoAdd && (
            <Pressable onPress={onAutoAdd} style={[styles.btn, styles.autoAdd, { backgroundColor: `${accent.secondary}22`, borderColor: accent.secondary }]}>
              <Plus s={13} c={accent.secondary} w={2.5} />
              <T size={12} w={800} color={accent.secondary}>{tx('epg.makeAuto')}</T>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Pill({ children, bg, fg, mono }: { children: string; bg: string; fg: string; mono?: boolean }) {
  return <View style={[styles.pill, { backgroundColor: bg }]}><T mono={mono} size={10} w={800} color={fg}>{children}</T></View>;
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      <T mono size={10} dim style={[styles.ls, styles.mb4]}>{title}</T>
      {children}
    </View>
  );
}

function Small({ title, value }: { title: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.small, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      <T mono size={8} dim style={styles.ls}>{title}</T>
      <T range mono size={11} w={700}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: oklch(0.48, 0.18, 145), borderColor: oklch(0.35, 0.18, 145) },
  scroll: { maxHeight: 560 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 },
  pill: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 5 },
  flag: { width: 18, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  mb10: { marginBottom: 10 },
  mb4: { marginBottom: 4 },
  idBox: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, marginBottom: 12 },
  ls: { letterSpacing: 0.5 },
  box: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  av: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  small: { flex: 1, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1 },
  actions: { gap: 8 },
  btn: { padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
  autoAdd: { padding: 11, flexDirection: 'row', justifyContent: 'center', gap: 6 },
});
