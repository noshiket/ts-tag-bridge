import type { VideoAddon } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AddonRunner } from '../../addons/AddonRunner';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 動画のアドオン（元の VideoAddonSection）: server/addon のアドオンの入力の宣言から入力を描き、動かして進み具合を見せる。
 * アドオンごとの画面は作らない（サーバーにアドオンを置くだけで使える）。アドオンが無ければ何も出さない
 */
export function VideoAddonSection({ videoId, node, onChanged }: { videoId: number; node: string | null; onChanged: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const addons = useQuery({ queryKey: ['videoAddons', node ?? ''], queryFn: () => api.videoActions.addons(node) });
  // 'comment_track' の項目は、この動画が持っているコメントのトラックから選ばせる（前スレの取り込み先へ足すため）
  const tracks = useQuery({ queryKey: ['addedTracks', node ?? '', videoId], queryFn: async () => (await api.videoActions.addedTracks(videoId, node)).comments?.map((x) => x.key) ?? [] });
  const [openName, setOpenName] = useState<string | null>(null);

  if (!addons.data?.length) return null;
  const open = (a: VideoAddon) => { if (!a.error) setOpenName(openName === a.name ? null : a.name); };

  return (
    <View style={styles.wrap}>
      <T mono size={9} w={700} dim style={styles.title}>{tx('common.addOns')}</T>
      {addons.data.map((a) => (
        <View key={a.name} style={[styles.item, { borderColor: theme.line, opacity: a.error ? 0.6 : 1 }]}>
          <Pressable onPress={() => open(a)} disabled={!!a.error} style={[styles.head, { backgroundColor: openName === a.name ? theme.surface2 : 'transparent' }]}>
            <T size={11} w={700}>{`${openName === a.name ? '▼ ' : '▶ '}${a.label}`}<T mono size={8} dim>{`  ${a.name}`}</T></T>
            {!!(a.description || a.error) && <T mono size={9} color={a.error ? '#ef4444' : theme.mute} style={styles.mt2}>{a.error ? tx('library.videoAddonSection.loadFailed', { v0: a.error }) : a.description}</T>}
          </Pressable>
          {openName === a.name && (
            <View style={[styles.body, { borderTopColor: theme.line }]}>
              <AddonRunner addon={a} node={node} onDone={onChanged} trackOptions={tracks.data}
                run={(vals) => api.videoActions.runAddon(videoId, a.name, vals, node)} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10, gap: 6 },
  title: { letterSpacing: 0.5, textAlign: 'center' },
  item: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  head: { paddingVertical: 8, paddingHorizontal: 12 },
  mt2: { marginTop: 2 },
  body: { paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1 },
});
