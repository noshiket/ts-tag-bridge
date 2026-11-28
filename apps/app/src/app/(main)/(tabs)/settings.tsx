import type { MsgKey } from '@tstag/core';
import { useMe } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountTab } from '../../../features/settings/account/AccountTab';
import { AddonsTab } from '../../../features/settings/AddonsTab';
import { AmzTab } from '../../../features/settings/amz/AmzTab';
import { AppTab } from '../../../features/settings/AppTab';
import { EdcbTab } from '../../../features/settings/EdcbTab';
import { LogoTab } from '../../../features/settings/LogoTab';
import { useViewNode } from '../../../lib/state/viewNode';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

type Tab = 'edcb' | 'amz' | 'app' | 'logo' | 'addon' | 'account';
// 名前は表示言語の辞書のキー
const ADMIN_TABS: [Tab, MsgKey][] = [['edcb', 'settings.tab.edcb'], ['amz', 'settings.tab.amz'], ['app', 'settings.tab.app'], ['logo', 'settings.tab.logo'], ['addon', 'settings.tab.addon']];

/**
 * 設定（元の settings.jsx の SettingsScreen）。サーバーの設定は管理者だけ（サーバーも 403 にする）で、他の利用者はアカウントだけ
 */
export default function SettingsScreen() {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const me = useMe().data;
  const isAdmin = !!me?.is_admin;
  const tabs: [Tab, MsgKey][] = [...(isAdmin ? ADMIN_TABS : []), ['account', 'settings.tab.account']];
  const [picked, setTab] = useState<Tab | null>(null);
  // 管理者は EDCB から（元と同じ）。利用者の情報が読めるまでは決めない
  const tab = picked ?? (isAdmin ? 'edcb' : 'account');
  const { viewNode } = useViewNode();
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TopBar title={tx('title.settings')} />
        <View style={styles.tabsWrap}>
          <View style={[styles.tabs, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {tabs.map(([k, l]) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, { backgroundColor: tab === k ? theme.ink : 'transparent' }]}>
                <T mono size={10} w={700} color={tab === k ? theme.onInk : theme.mute} numberOfLines={1}>{tx(l)}</T>
              </Pressable>
            ))}
          </View>
        </View>
        {/* サーバーを切り替えたら中身を作り直す。編集途中の値や、前のサーバーの読み込みが遅れて届いた結果を残すと、
            別のサーバーへ保存してしまう */}
        <View key={viewNode ?? ''} style={styles.body}>
          {tab === 'account' ? <AccountTab /> : tab === 'edcb' ? <EdcbTab /> : tab === 'amz' ? <AmzTab /> : tab === 'app' ? <AppTab /> : tab === 'logo' ? <LogoTab /> : <AddonsTab />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  tabsWrap: { paddingHorizontal: 18, paddingBottom: 12 },
  tabs: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 12, borderWidth: 1 },
  tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center' },
  body: { paddingHorizontal: 18 },
});
