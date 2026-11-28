import { Pressable, StyleSheet, View } from 'react-native';

import { AmzProfiles } from './AmzProfiles';
import { AmzQueue } from './AmzQueue';
import { AmzConnection, AmzDisks } from './AmzStatusCards';
import { AMZ_RED } from './amzStyles';
import { useAmzStatus } from './useAmzStatus';
import { oklch } from '../../../ui/theme/oklch';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 設定の「AMZ」（元の SettingsAmatsukaze）: 接続先と状態、ディスク、プロファイル（見る・編集・別名で保存・名前を変える・消す・足す）、
 * キュー（中止・削除）、キューの停止と再開。見ているサーバーの Amatsukaze
 */
export function AmzTab() {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const s = useAmzStatus();
  const ops = [
    { l: s.paused ? 'キュー再開\npause(false)' : 'キュー停止\npause(true)', c: s.paused ? accent.primary : AMZ_RED, fn: s.togglePause, dis: s.loading || !!s.error },
    { l: tx('settings.amzTab.testConnectionFetchamzsystem'), c: accent.quaternary, fn: s.load, dis: s.loading },
  ];
  return (
    <>
      <AmzConnection amzUrl={s.amzUrl} loading={s.loading} error={s.error} paused={s.paused} />
      <AmzDisks disks={s.disks} />
      <AmzProfiles profiles={s.profiles} setProfiles={s.setProfiles} loading={s.loading} />
      {s.error && <View style={styles.err}><T mono size={11} color={oklch(0.4, 0.22, 25)}>{`ERROR: ${s.error}`}</T></View>}
      <AmzQueue />
      <SectionTitle>{tx('common.actions')}</SectionTitle>
      <View style={styles.ops}>
        {ops.map((b, i) => (
          <Pressable key={i} onPress={() => void b.fn()} disabled={b.dis} style={[styles.op, {
            backgroundColor: b.dis ? theme.surface2 : theme.surface, borderColor: theme.frame, boxShadow: b.dis ? 'none' : shadow(theme, 2), opacity: b.dis ? 0.5 : 1,
          }]}>
            <View style={[styles.dot, { backgroundColor: b.dis ? theme.mute : b.c }]} />
            <T mono size={10} w={700} style={styles.center}>{b.l}</T>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  err: { marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: oklch(0.95, 0.05, 25) },
  ops: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  op: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  center: { textAlign: 'center', lineHeight: 14 },
});
