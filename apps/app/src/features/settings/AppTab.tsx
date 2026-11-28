import { LOG_LEVELS, audioJobKind, audioJobNote, audioJobState, audioJobTitle, logLink } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { useViewNode } from '../../lib/state/viewNode';
import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { Switch } from '../../ui/inputs/Switch';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { ConfigEditor } from './config/ConfigEditor';
import { LocalCacheSection } from './LocalCacheSection';
import { Card, SRow } from './parts';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const RED = oklch(0.6, 0.22, 25);

/**
 * 設定の「アプリ」（元の SettingsApp）: サーバーの設定、音声解析の順番待ち、ローカルキャッシュ、アプリのログ。
 * 元の「画面の読み込みキャッシュだけ作り直す」は Web 版の仕組みの話なので無い
 */
export function AppTab() {
  const { t: tx } = useT();
  return (
    <>
      <ConfigEditor />
      <AudioQueue />
      <LocalCacheSection />
      {/* ログの箱は高く、中でスクロールするので、その下に置くと指が届きにくい。先に出す */}
      <SectionTitle>{tx('settings.appTab.developer')}</SectionTitle>
      <Card>
        <SRow title={tx('common.list')} titleEn={tx('settings.general.apiDesc')} value="" last onPress={() => router.push('/api-docs')} />
      </Card>
      <AppLogs />
    </>
  );
}

/** 音声解析の順番待ち（このサーバーのもの。動いている間は進み具合が変わるので5秒ごとに取り直す） */
function AudioQueue() {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const q = useQuery({ queryKey: ['settings', 'audioQueue'], queryFn: async () => (await api.settings.audioQueue()).jobs ?? [], refetchInterval: 5000 });
  const cancel = async (id: string) => { try { await api.settings.cancelAudioJob(id); } catch { /* 動き出していた等 */ } void q.refetch(); };
  return (
    <>
      <SectionTitle>{tx('settings.appTab.audioSyncQueue')}</SectionTitle>
      <Card>
        <T mono size={9} dim style={styles.note}>
          {tx('settings.appTab.captionImportAudioCompare')}
        </T>
        {!q.data && <T mono size={9} dim style={styles.note}>{tx('common.loading2')}</T>}
        {q.data?.length === 0 && <T mono size={9} dim style={styles.note}>{tx('settings.appTab.noJobs')}</T>}
        {(q.data ?? []).map((j) => (
          <View key={j.id} style={[styles.job, { borderTopColor: theme.line }]}>
            <T mono size={9} w={700} color={j.state === 'running' ? accent.primary : j.state === 'error' ? RED : theme.mute} style={styles.state}>{audioJobState(j)}</T>
            <T mono size={9} dim style={styles.kind} accessibilityHint={audioJobKind(j).hint}>{audioJobKind(j).label}</T>
            <View style={styles.grow}>
              <T mono size={9} numberOfLines={1}>{audioJobTitle(j)}</T>
              {!!audioJobNote(j) && <T mono size={9} dim numberOfLines={1}>{audioJobNote(j)}</T>}
            </View>
            {j.state === 'queued' && (
              <Pressable onPress={() => void cancel(j.id)} style={[styles.cancel, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <T mono size={9} w={700} color={RED}>{tx('settings.appTab.cancel')}</T>
              </Pressable>
            )}
          </View>
        ))}
      </Card>
    </>
  );
}

/** アプリのログ（見ているサーバーのもの。5秒ごとに取り直す）。予約・録画の番号があれば、そこへ飛べる */
function AppLogs() {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const { viewNode } = useViewNode();
  const [level, setLevel] = useState<(typeof LOG_LEVELS)[number]>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const ref = useRef<ScrollViewInstance>(null);
  const logs = useQuery({
    queryKey: ['settings', viewNode ?? '', 'logs', level],
    queryFn: () => api.settings.logs(level === 'ALL' ? null : level, viewNode),
    refetchInterval: 5000,
  });
  useEffect(() => { if (autoScroll) setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 0); }, [logs.data, autoScroll]);
  const color: Record<string, string> = { DEBUG: theme.mute, INFO: oklch(0.55, 0.15, 250), WARNING: oklch(0.6, 0.22, 70), ERROR: oklch(0.55, 0.25, 25) };

  return (
    <>
      <SectionTitle>{tx('settings.appTab.appLogs')}</SectionTitle>
      <View style={styles.levels}>
        {LOG_LEVELS.map((lv) => (
          <Pressable key={lv} onPress={() => setLevel(lv)}
            style={[styles.level, { backgroundColor: level === lv ? theme.ink : theme.surface2, borderColor: level === lv ? theme.ink : theme.line }]}>
            <T mono size={9} w={700} color={level === lv ? theme.onInk : theme.mute}>{lv}</T>
          </Pressable>
        ))}
        <View style={styles.grow} />
        <T mono size={9} dim>auto-scroll</T>
        <Switch on={autoScroll} onChange={() => setAutoScroll(!autoScroll)} label="auto-scroll" />
        <Pressable onPress={() => void logs.refetch()} style={[styles.level, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <T mono size={9} w={700}>{tx('settings.appTab.refresh')}</T>
        </Pressable>
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets ref={ref} nestedScrollEnabled style={[styles.logs, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}
        onScroll={(e) => { const n = e.nativeEvent; setAutoScroll(n.contentSize.height - n.contentOffset.y - n.layoutMeasurement.height < 30); }}
        scrollEventThrottle={200}>
        {!logs.data ? <T mono size={10} dim style={styles.pad12}>{tx('common.loading')}</T> : logs.data.length === 0 ? <T mono size={10} dim style={styles.pad12}>{tx('settings.appTab.noLogs')}</T>
          : logs.data.map((e, i) => {
            const link = logLink(e.message);
            return (
              <View key={i} style={[styles.log, { borderBottomColor: theme.line },
                e.level === 'ERROR' && { backgroundColor: 'rgba(220,60,60,0.08)' }, e.level === 'WARNING' && { backgroundColor: 'rgba(230,160,40,0.06)' }]}>
                <View style={styles.logHead}>
                  <T mono size={9} dim>{(e.time || '').slice(11, 23)}</T>
                  <T mono size={9} w={700} color={color[e.level] ?? theme.ink} style={styles.lv}>{e.level?.slice(0, 4)}</T>
                  <T mono size={9} dim numberOfLines={1} style={styles.name}>{e.name}</T>
                  <View style={styles.grow} />
                  {link && (
                    // 詳細は見ているサーバーのものを開く（ログと同じサーバー）
                    <Pressable onPress={() => router.push(link.kind === 'reserve'
                      ? { pathname: '/reserve/[id]', params: { id: String(link.id) } }
                      : { pathname: '/recording/[id]', params: { id: String(link.id) } })}
                      style={[styles.link, { backgroundColor: link.kind === 'reserve' ? accent.primary : accent.tertiary }]}>
                      <T mono size={8} w={700} color="#fff">{link.kind === 'reserve' ? tx('settings.appTab.reserve') : tx('settings.appTab.recording')}</T>
                    </Pressable>
                  )}
                </View>
                <T mono size={11} style={styles.msg}>{e.message}</T>
              </View>
            );
          })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  note: { paddingVertical: 9, paddingHorizontal: 13, lineHeight: 15 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 13, borderTopWidth: 1 },
  state: { minWidth: 64 },
  kind: { minWidth: 52 },
  grow: { flex: 1, minWidth: 0 },
  cancel: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 8 },
  level: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1 },
  logs: { maxHeight: 480, borderWidth: 1.5, borderRadius: 12, marginBottom: 16 },
  pad12: { padding: 12 },
  log: { paddingVertical: 3, paddingHorizontal: 10, borderBottomWidth: 1 },
  logHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lv: { minWidth: 32 },
  name: { maxWidth: 90 },
  link: { paddingVertical: 1, paddingHorizontal: 6, borderRadius: 4 },
  msg: { marginTop: 1 },
});
