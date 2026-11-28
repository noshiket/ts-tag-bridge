import type { PlayerTabAddon } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { AddonRunner } from '../../addons/AddonRunner';

/** 再生画面のタブのうち、アドオンが増やすものの鍵（addon:<アドオンの名前>） */
export type AddonTabKey = `addon:${string}`;
export const addonTabKey = (name: string): AddonTabKey => `addon:${name}`;
export const isAddonTab = (k: string): k is AddonTabKey => k.startsWith('addon:');

/**
 * 再生画面のタブを増やすアドオン（有効で読み込めたもの）。今の動画・録画に合うものだけ
 * （source: 'recording' は録画だけ、それ以外はライブラリの動画だけ）。音楽には出さない（元と同じ）
 */
export function usePlayerTabAddons(node: string | null, rec: boolean, music: boolean): PlayerTabAddon[] {
  const api = useApi();
  const q = useQuery({ queryKey: ['playerTabs', node ?? ''], queryFn: () => api.videoActions.playerTabs(node), staleTime: 60_000 });
  if (music) return [];
  return (q.data ?? []).filter((a) => !a.error && ((a.source === 'recording') === rec));
}

/**
 * 部品を名乗らない（または画面が知らない部品を名乗る）アドオンのタブ。params から入力欄を描き、
 * 今の動画・録画に対して実行するだけ。アドオンを足しても画面の作り直しは要らない
 */
export function GenericAddonTab({ addon, id, rec, node }: { addon: PlayerTabAddon; id: number; rec: boolean; node: string | null }) {
  const api = useApi();
  return (
    <View style={{ padding: 14 }}>
      <AddonRunner addon={addon} node={node}
        run={(vals) => (rec ? api.recordings.runAddon(id, addon.name, vals, node) : api.videoActions.runAddon(id, addon.name, vals, node))} />
    </View>
  );
}
