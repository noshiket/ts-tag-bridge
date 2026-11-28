import { useMe } from '@tstag/core/react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LanguageSection } from './LanguageSection';
import { ListViewSection } from './ListViewSection';
import { PageSizeSection } from './PageSizeSection';
import { ThemeSection } from './ThemeSection';
import { UsersSection } from './UsersSection';
import { confirmAsync } from '../../../lib/device/confirm';
import { useSession } from '../../../session/SessionProvider';
import { oklch } from '../../../ui/theme/oklch';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';
import { Card } from '../parts';

/**
 * 設定の「アカウント」（元の SettingsAccount）: ログイン中の利用者とログアウト、テーマ・アクセント（アカウントに保存）、
 * 一覧の表示（予約・録画結果・アルバム）、一覧の件数（アカウントの既定と、この端末だけの上書き）。管理者には承認待ち・利用者の管理（承認・権限・削除）も出す。
 * 元にある「リモコン操作」は Fire TV のブラウザ向けなので、このアプリには無い
 */
export function AccountTab() {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const me = useMe().data;
  const { signOut, needsServerUrl, serverUrl } = useSession();
  const isAdmin = !!me?.is_admin;
  const changeServer = async () => {
    if (await confirmAsync(tx('settings.account.changeServerConfirm'), tx('settings.account.logout'))) await signOut();
  };
  return (
    <>
      <SectionTitle>{tx('settings.account.login')}</SectionTitle>
      <Card>
        <View style={[styles.userRow, { borderBottomColor: theme.line }]}>
          <T size={13} w={700}>{me?.username ?? ''}</T>
          <T mono size={9} dim style={styles.mt2}>{isAdmin ? tx('settings.account.admin') : 'USER'}</T>
        </View>
        <Pressable onPress={() => void signOut()} style={styles.logout}>
          <T mono size={12} w={700} color={oklch(0.65, 0.22, 25)}>{tx('settings.account.logout')}</T>
        </Pressable>
      </Card>
      {/* アプリだけ（Web は配った場所がサーバー）。別のサーバーにはログインし直して入る（端末用の鍵はサーバーごと） */}
      {needsServerUrl && (
        <>
          <SectionTitle>{tx('settings.account.server')}</SectionTitle>
          <Card>
            <View style={[styles.userRow, { borderBottomColor: theme.line }]}>
              <T mono size={12} w={700}>{serverUrl}</T>
              <T mono size={9} dim style={styles.mt2}>{tx('settings.account.serverNote')}</T>
            </View>
            <Pressable onPress={() => void changeServer()} style={styles.logout}>
              <T mono size={12} w={700}>{tx('settings.account.changeServer')}</T>
            </Pressable>
          </Card>
        </>
      )}
      <LanguageSection />
      <ThemeSection />
      <ListViewSection />
      <PageSizeSection />
      {isAdmin && me && <UsersSection meId={me.id} />}
    </>
  );
}

const styles = StyleSheet.create({
  userRow: { paddingVertical: 12, paddingHorizontal: 13, borderBottomWidth: 1 },
  mt2: { marginTop: 2 },
  logout: { paddingVertical: 11, paddingHorizontal: 13 },
});
