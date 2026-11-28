import { API_AUTH_LABEL, filterApiRoutes, groupApiRoutes, type ApiRoute } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiRouteRow } from '../../features/settings/apiDocs/ApiRouteRow';
import { useViewNode } from '../../lib/state/viewNode';
import { T } from '../../ui/parts/T';
import { TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * 開発者向けの API の一覧（設定 → アプリ → 開発者向け から開く）。見ているサーバーの口を、
 * サーバーが自分の口と説明書きから作った一覧（GET /api/docs/routes）のまま出す
 */
export default function ApiDocsScreen() {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const api = useApi();
  const { viewNode } = useViewNode();
  const [query, setQuery] = useState('');
  const q = useQuery({ queryKey: ['settings', viewNode ?? '', 'apiRoutes'], queryFn: async () => (await api.settings.apiRoutes(viewNode)).routes });
  const sections = useMemo(
    () => groupApiRoutes(filterApiRoutes(q.data ?? [], query)).map((g) => ({ title: g.group, count: g.routes.length, data: g.routes })),
    [q.data, query]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  const count = sections.reduce((n, s) => n + s.data.length, 0);
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <TopBar title={tx('common.list')} onBack={back} />
      <View style={styles.pad}>
        <T size={10} dim style={styles.note}>
          {tx('screens.apidocs.theseSEndpointsCall', { v0: viewNode ?? tx('screens.apidocs.server') }) +
            tx('screens.apidocs.issueLongLivedToken') +
            tx('screens.apidocs.whoCallTapRow', { v0: Object.values(API_AUTH_LABEL).join(tx('common.dotSeparator')) })}
        </T>
        <TextInput value={query} onChangeText={setQuery} placeholder={tx('screens.apidocs.filterDescriptionMethodSpace')}
          placeholderTextColor={theme.mute} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing"
          style={[styles.search, { backgroundColor: theme.surface2, color: theme.ink, borderColor: theme.line }]} />
        <T mono size={9} dim>{q.isError ? tx('screens.apidocs.couldntLoadAdminsOnly') : !q.data ? tx('common.loading2') : tx('screens.apidocs.routes', { v0: count })}</T>
      </View>
      <SectionList<ApiRoute, { title: string; count: number }>
        sections={sections}
        keyExtractor={(r) => `${r.methods.join(',')} ${r.path}`}
        renderItem={({ item }) => <ApiRouteRow route={item} />}
        renderSectionHeader={({ section }) => (
          <View style={[styles.group, { backgroundColor: theme.bg, borderBottomColor: theme.ink }]}>
            <T mono size={11} w={700}>/api/{section.title}</T>
            <T mono size={9} dim>{section.count}</T>
          </View>
        )}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 18, gap: 8, paddingBottom: 8 },
  note: { lineHeight: 15 },
  search: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  list: { paddingHorizontal: 18, paddingBottom: 60 },
  group: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 14, paddingBottom: 4, borderBottomWidth: 2 },
});
