import { formatBroadcast, formatDuration, hasTelop, type StreamMeta } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProgramText } from '../../../ui/parts/ProgramText';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const clock = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * 「番組情報」タブ（元の ProgramInfoTab）: 放送日と局、放送時刻・残り・ジャンルと進み、
 * テロップ告知（動画だけ。しょぼいカレンダーから取り直す・手で有/無）、題名、解析で決まった値（シリーズ・話数・サブタイトル）、説明・詳細
 */
export function ProgramInfo({ meta, rec, videoId, node, time, onEdit }: {
  meta: StreamMeta;
  rec: boolean;
  videoId: number;
  node: string | null;
  time: number;
  /** 確定値のタブへ */
  onEdit: () => void;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const api = useApi();
  const [announce, setAnnounce] = useState(meta.announce ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setAnnounce(meta.announce ?? ''); setMsg(null); }, [videoId, meta.announce]);
  const telop = hasTelop(announce);
  const run = async (f: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { const v = await f(); if (v != null) setAnnounce(v); } catch (e) { setMsg(tx('player.programInfo.failed', { v0: String(e) })); } finally { setBusy(false); }
  };
  const fetchIt = () => run(async () => {
    const r = await api.videoActions.fetchAnnounce(videoId, node);
    if (!r.fetched) { setMsg(tx('player.programInfo.couldntGetAnnouncementInfo')); return null; }
    return r.announce ?? '';
  });
  const setIt = (v: string) => run(async () => (await api.videoActions.setAnnounce(videoId, v, node)).announce);

  const date = formatBroadcast(meta.start_time).replace(/ \d\d:\d\d$/, '');
  const total = meta.duration || 0;
  const pct = total > 0 ? Math.min(100, Math.max(0, (time / total) * 100)) : 0;
  const remain = Math.max(0, Math.ceil((total - time) / 60));
  // 放送時刻があれば放送の開始–終了、無ければ再生位置–全尺（元と同じ）
  const span = `${clock(meta.start_time) || formatDuration(time)} – ${clock(meta.end_time) || formatDuration(total)}`;
  const parsed: [string, string][] = ([
    ['シリーズ', meta.series_name ?? ''],
    ['話数', meta.episode_number != null && String(meta.episode_number) !== '' ? `#${meta.episode_number}` : ''],
    ['サブタイトル', meta.episode_name ?? ''],
  ] as [string, string][]).filter(([, v]) => v);
  const btn = [styles.btn, { borderColor: theme.line, opacity: busy ? 0.6 : 1 }];
  return (
    <View style={styles.wrap}>
      {date || meta.station_name ? <T mono size={11} dim>{[date, meta.station_name].filter(Boolean).join(' ')}</T> : null}
      <T mono size={11} dim>{`${span}  |  残り ${remain} 分${meta.genre ? `  |  ${meta.genre}` : ''}`}</T>
      <View style={[styles.bar, { backgroundColor: theme.surface2 }]}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
      {!rec && (
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: telop ? '#E0A030' : theme.surface2 }]}>
            <T mono size={11} w={800} color={telop ? '#000' : theme.mute}>{telop ? `⚠${announce}` : tx('player.programInfo.noTicker')}</T>
          </View>
          <Pressable onPress={fetchIt} disabled={busy} style={[btn, { backgroundColor: theme.surface2 }]}><T mono size={10}>{tx('player.programInfo.getDisasterNotices')}</T></Pressable>
          <Pressable onPress={() => setIt(tx('player.programInfo.tickerManual'))} disabled={busy} accessibilityLabel={tx('player.programInfo.markHavingTicker')} style={btn}><T mono size={10} dim>{tx('player.programInfo.yes')}</T></Pressable>
          <Pressable onPress={() => setIt(tx('player.programInfo.noneManual'))} disabled={busy} accessibilityLabel={tx('player.programInfo.markNoTicker')} style={btn}><T mono size={10} dim>{tx('player.programInfo.no')}</T></Pressable>
        </View>
      )}
      {msg ? <T size={11} color="#E62B34">{msg}</T> : null}
      <T range size={16} w={800}>{meta.title || tx('common.noProgramInfo2')}</T>
      {/* 解析で決まった値（ライブラリでの並び）。放送のタイトルとは別物なので分けて出す */}
      {parsed.length > 0 && (
        <View style={[styles.parsed, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {parsed.map(([k, v]) => (
            <View key={k} style={styles.kv}>
              <T mono size={10} dim style={styles.k}>{k}</T>
              <T range size={12} w={700} style={styles.v}>{v}</T>
            </View>
          ))}
          <Pressable onPress={onEdit} accessibilityLabel={tx('player.programInfo.fixConfirmedValues')} style={[styles.btn, styles.edit, { borderColor: theme.line }]}>
            <T mono size={9} dim>{tx('player.programInfo.editConfirmedValues')}</T>
          </Pressable>
        </View>
      )}
      {meta.description ? <ProgramText text={meta.description} size={12} /> : null}
      {meta.extended_info ? <ProgramText text={meta.extended_info} size={12} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 14, gap: 8 },
  bar: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#10b981', borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 5 },
  btn: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 5, borderWidth: 1 },
  parsed: { gap: 2, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1 },
  kv: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  k: { minWidth: 74 },
  v: { flex: 1 },
  edit: { alignSelf: 'flex-start', marginTop: 2 },
});
