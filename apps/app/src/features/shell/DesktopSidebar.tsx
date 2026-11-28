import { useMe } from '@tstag/core/react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '../../session/SessionProvider';
import { brutal } from '../../ui/theme/edge';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { NavBadge, ServerMark, useNavItems, useServerSwitch } from './TabBar';
import { useT } from '../../ui/i18n/I18n';

/**
 * PC の幅のナビ（元の frames.jsx の DesktopSidebar）。左に縦の帯で、上に TS TAG BRIDGE、
 * 番組表〜設定、下に EDCB の接続・利用者・ログアウト。スマホの幅では下のタブ（TabBar）
 */
export function DesktopSidebar() {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const me = useMe().data;
  const { signOut } = useSession();
  const { items, path, go } = useNavItems();
  const sv = useServerSwitch(path);
  const ring = theme.isDark ? theme.surface : theme.surface2;
  return (
    <SafeAreaView edges={['top', 'bottom', 'left']} style={[styles.wrap, { backgroundColor: ring, borderRightColor: theme.line }]}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <View style={[styles.logo, brutal(theme, 2), { backgroundColor: accent.primary }]}><T mono size={12} w={700} color="#fff">TS</T></View>
        <T mono size={12} w={700}>TS TAG BRIDGE</T>
      </View>
      <View style={styles.list}>
        {items.map((t) => (
          <Pressable key={t.id} onPress={() => go(t.path)} accessibilityRole="tab" accessibilityState={{ selected: t.active }}
            style={[styles.item, { backgroundColor: t.active ? accent.primary : 'transparent' }]}>
            <View>
              <t.Icon s={17} c={t.active ? '#fff' : theme.mute} />
              {t.badge && <NavBadge {...t.badge} ring={ring} />}
            </View>
            <View>
              <T size={13} w={t.active ? 700 : 400} color={t.active ? '#fff' : theme.ink} style={styles.lh}>{t.label}</T>
            </View>
          </Pressable>
        ))}
        {/* 見るサーバーの切り替え（下のタブと同じ決まり。他のサーバーが無ければ出さない） */}
        {sv && (
          <Pressable onPress={sv.next} disabled={!sv.canSwitch} accessibilityRole={sv.canSwitch ? 'button' : 'text'} accessibilityLabel={sv.label}
            style={[styles.item, styles.server, { borderTopColor: theme.line }, !sv.canSwitch && styles.locked]}>
            <ServerMark num={sv.num} other={sv.other} ring={ring} s={17} />
            <View style={styles.grow}>
              <T size={13} color={sv.other ? accent.primary : theme.ink} numberOfLines={1} style={styles.lh}>{sv.name}</T>
            </View>
          </Pressable>
        )}
      </View>
      <View style={[styles.foot, { borderTopColor: theme.line }]}>
        <View style={styles.row}>
          <View style={styles.dotOk} />
          <T mono size={9} dim>EDCB connected</T>
        </View>
        {me && (
          <View style={[styles.row, styles.user]}>
            <View>
              <T mono size={11} w={700}>{`${me.username}${me.is_admin ? ' ★' : ''}`}</T>
              <T mono size={8} dim>{me.is_admin ? 'ADMIN' : 'USER'}</T>
            </View>
            <Pressable onPress={() => void signOut()} style={[styles.logout, { borderColor: theme.line }]}>
              <T mono size={9} w={700} dim>{tx('settings.account.logout')}</T>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 192, borderRightWidth: 1 },
  head: { paddingTop: 18, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1 },
  logo: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1, padding: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 2, borderRadius: 8 },
  server: { marginTop: 6, borderTopWidth: 1, borderRadius: 0, paddingTop: 12 },
  locked: { opacity: 0.45 },
  grow: { flex: 1, minWidth: 0 },
  lh: { lineHeight: 16 },
  foot: { paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  user: { justifyContent: 'space-between', marginTop: 8 },
  dotOk: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#28c840' },
  logout: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
});
