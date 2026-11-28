import { queryKeys, useApi, useNodes } from '@tstag/core/react';
import { useQueries } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';

/**
 * フォルダ・カテゴリと同じ名前のアルバム・カテゴリへ飛ぶ ↗（元の detail.jsx と同じ）。
 * アルバムはまずこのサーバーのライブラリから探し、無ければマスター（library_peer）、最後にこの録画のサーバー。
 * 送る側はエンコードした動画をマスターへ送るので、アルバムはたいていマスターにしかない。
 * 見つけたサーバーの物として開く（node を渡す。開いた画面がそのサーバーへ切り替え、戻ると詳細のサーバーへ戻る）。
 * off（狭い所）では探さず何も出さない（再生が止まるので）
 */
export function useLibraryLink(node: string | null, off: boolean, seriesName?: string) {
  const api = useApi();
  const { theme, accent } = useTheme();
  const peer = useNodes().data?.library_peer ?? null;
  const servers = useMemo(() => [...new Set<string | null>([null, peer, node])], [peer, node]);
  const libLists = useQueries({
    queries: servers.flatMap((n) => [
      { queryKey: queryKeys.albums(n), queryFn: () => api.library.albums(n), enabled: !off },
      { queryKey: ['videoCategories', n ?? ''], queryFn: () => api.library.categories(n), enabled: !off },
    ]),
  });
  const findLib = (kind: 'album' | 'category', name: string): { id: number; node: string | null } | null => {
    for (let i = 0; i < servers.length; i++) {
      const list = (libLists[i * 2 + (kind === 'album' ? 0 : 1)]?.data ?? []) as { id: number; name: string }[];
      const hit = list.find((x) => String(x.name ?? '').trim() === name);
      if (hit) return { id: hit.id, node: servers[i] ?? null };
    }
    return null;
  };

  return (key: string, value: string) => {
    const isFolder = key === 'folder';
    if (off || (!isFolder && key !== 'category')) return null;
    const name = value.trim();
    if (!name) return null;
    const hit = findLib(isFolder ? 'album' : 'category', name);
    if (!hit) return null;
    // アルバムは詳細のタイトル（＝シリーズ名）のシリーズを選んで開く
    const params = { id: String(hit.id), node: hit.node ?? '', ...(isFolder && seriesName?.trim() ? { seriesName: seriesName.trim() } : {}) };
    const open = () => router.push(isFolder ? { pathname: '/album/[id]', params } : { pathname: '/category/[id]', params });
    return (
      <Pressable onPress={open} accessibilityLabel={`ライブラリで${isFolder ? 'アルバム' : 'カテゴリ'}「${name}」を開く${hit.node ? `（${hit.node}）` : ''}`}
        style={[styles.small, { borderColor: theme.line }]}>
        <T mono size={9} w={800} color={accent.secondary}>↗</T>
      </Pressable>
    );
  };
}

const styles = StyleSheet.create({
  small: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 4, borderWidth: 1, flexShrink: 0 },
});
