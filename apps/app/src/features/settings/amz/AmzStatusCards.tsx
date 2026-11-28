import { amzDiskUsed, uniqueAmzDisks, type AmzDisk } from '@tstag/core';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AMZ_RED, amzStyles } from './amzStyles';
import { Card } from '../parts';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const toGb = (b: number) => (b / 1e9).toFixed(1);

/** 接続 / CONNECTION: 接続先（押すと Amatsukaze の画面を開く）・接続状態・エンコードの停止/稼働 */
export function AmzConnection({ amzUrl, loading, error, paused }: { amzUrl: string; loading: boolean; error: string | null; paused: boolean }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const conn = [
    { title: 'ホスト / Host', sub: 'AmatsukazeClient(url)', val: amzUrl.replace(/^https?:\/\//, '') || '—', c: theme.ink },
    { title: tx('settings.amzStatusCards.connection'), sub: 'connection status', val: loading ? 'loading...' : error ? '✗ 接続失敗' : tx('settings.amzStatusCards.connected'), c: loading ? theme.mute : error ? AMZ_RED : accent.quaternary },
    { title: tx('settings.amzStatusCards.encodingState'), sub: 'state.pause', val: loading ? 'loading...' : error ? '—' : paused ? '⏸ 停止中' : tx('settings.amzStatusCards.running'), c: loading || error ? theme.mute : paused ? AMZ_RED : accent.primary },
  ];
  return (
    <>
      <SectionTitle>{tx('settings.amzStatusCards.connection2')}</SectionTitle>
      <Card>
        {conn.map((r, i) => (
          <Pressable key={r.title} disabled={i !== 0 || !amzUrl} onPress={() => void Linking.openURL(amzUrl)}
            style={[styles.row, i < conn.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
            <View style={amzStyles.grow}><T size={12} w={500}>{r.title}</T><T mono size={9} dim>{r.sub}</T></View>
            <T mono size={11} w={700} color={r.c}>{r.val}</T>
          </Pressable>
        ))}
      </Card>
    </>
  );
}

/** ストレージ / info/disks: 空きと使用率のバー（85%を超えたら赤）。同じディスクは1つにまとめる */
export function AmzDisks({ disks }: { disks: AmzDisk[] }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const shown = uniqueAmzDisks(disks);
  if (shown.length === 0) return null;
  return (
    <>
      <SectionTitle>{tx('settings.amzStatusCards.storageInfo')}</SectionTitle>
      <Card>
        {shown.map((d, i) => {
          const pct = amzDiskUsed(d);
          return (
            <View key={i} style={[styles.pad, i < shown.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
              <View style={styles.diskHead}>
                <T mono size={11} w={700} numberOfLines={1} style={styles.shrink}>{d.path || `Disk ${i + 1}`}</T>
                <T mono size={10} dim>{tx('settings.amzStatusCards.gbFreeGb', { v0: toGb(d.freeBytes), v1: toGb(d.capacityBytes) })}</T>
              </View>
              <View style={[styles.bar, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct > 0.85 ? AMZ_RED : accent.primary }} />
              </View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13 },
  shrink: { flexShrink: 1 },
  pad: { paddingVertical: 11, paddingHorizontal: 13 },
  diskHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', borderWidth: 1 },
});
