import { videoContextLabel } from '@tstag/core';
import { useApi, usePatchPrefs, usePrefs } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VideoCard } from '../../../features/library/VideoCard';
import { TabBar } from '../../../features/shell/TabBar';
import { usePrivateMode } from '../../../lib/state/privateMode';
import { useScreenNode } from '../../../lib/state/viewNode';
import { More } from '../../../ui/parts/Icons';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { errorBox } from '../../../ui/theme/theme';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/**
 * カテゴリ（元の LibraryScreen のカテゴリページ）: アルバムをまたいで、そのカテゴリの動画を並べる。動画カードの #カテゴリ から開く。
 * 「…」でこのカテゴリを自分の非公開に入れる・外す（指定した本人にだけ効く）
 */
export default function CategoryScreen() {
  const { t: tx } = useT();
  // node: 別のサーバーのカテゴリとして開く時（詳細の ↗ から。空文字はこのサーバー）
  const { id, node: nodeParam } = useLocalSearchParams<{ id: string; node?: string }>();
  const api = useApi();
  const { theme } = useTheme();
  const viewNode = useScreenNode(nodeParam);
  const q = useQuery({ queryKey: ['library', viewNode ?? '', 'category', Number(id)], queryFn: () => api.library.category(Number(id), viewNode) });
  const prefs = usePrefs(true);
  const patch = usePatchPrefs();
  const [privMode, setPrivMode] = usePrivateMode();
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const privCats = prefs.data?.private_categories ?? [];
  const name = q.data?.name;
  const isPrivate = !!name && privCats.includes(name);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const togglePrivate = () => {
    if (!name) return;
    const next = isPrivate ? privCats.filter((c) => c !== name) : [...privCats, name];
    patch.mutate({ private_categories: next }, {
      onSuccess: (p) => {
        // 指定が空になったのにモードが入ったままだと分かりにくいので切る
        if (!(p.private_categories ?? next).length && privMode) setPrivMode(false);
        void q.refetch();
      },
      onError: (e) => setErr(e instanceof Error ? e.message : tx('screens.category.saveFailed')),
    });
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <TopBar title={name ? `#${name}` : tx('screens.category.title')} onBack={back} right={
            <Pressable onPress={() => setMenu(true)} accessibilityLabel={tx('screens.category.menu')}
              style={[styles.more, { backgroundColor: theme.surface, borderColor: theme.line, boxShadow: shadow(theme, 2) }]}>
              <More c={theme.ink} />
            </Pressable>
        } />
        {(err || q.error) && (
          <View style={[styles.error, { backgroundColor: errorBox.bg, borderColor: errorBox.border }]}>
            <T mono size={11} color={errorBox.text}>{err ?? q.error?.message ?? ''}</T>
          </View>
        )}
        {!q.data && !q.error && <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>}
        {q.data && (
          <View style={styles.list}>
            {q.data.videos.length === 0 && <T size={12} dim style={styles.empty}>{tx('screens.category.empty')}</T>}
            {q.data.videos.map((v) => (
              <VideoCard key={v.id} video={v} node={viewNode} albumName={v.album_name ?? undefined}
                contextLabel={videoContextLabel(v)}
                onPlay={() => router.push({ pathname: '/watch/[id]', params: { id: String(v.id) } })} />
            ))}
          </View>
        )}
      </ScrollView>
      <Sheet open={menu} onClose={() => setMenu(false)} title={name ? `#${name}` : tx('screens.category.title')}>
        <SheetItem first label={isPrivate ? tx('screens.category.privateOn') : tx('screens.category.private')} sub={isPrivate ? tx('screens.category.privateOnSub') : tx('screens.category.privateSub')}
          onPress={() => { setMenu(false); togglePrivate(); }} />
      </Sheet>
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 110 },
  more: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  error: { marginHorizontal: 18, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1 },
  empty: { textAlign: 'center', padding: 40 },
  list: { paddingHorizontal: 18, gap: 6 },
});
