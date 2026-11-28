import { paginate, videoContextLabel, type LocalItem } from '@tstag/core';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActiveRow, SavedRow, playLocal, useLocalPoster } from './LocalSaveRows';
import type { LocalCard } from './useLocalSaveList';
import { useLocalSaveList } from './useLocalSaveList';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import type { ActiveItem } from '../../../lib/localSave/store';
import { useViewNode } from '../../../lib/state/viewNode';
import { PagerBar } from '../../../ui/parts/PagerBar';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { VideoCard } from '../VideoCard';
import { useT } from '../../../ui/i18n/I18n';

/**
 * ライブラリの「ローカル保存」（元の encode.jsx の LocalSavedList）: 見ているサーバーの分の、保存中（進み具合と取り消し）と
 * 保存済み。保存済みはライブラリと同じカードで出し、カードが引けない時（通信なし・ライブラリから消えた）は控えた情報で出す。
 * 非公開カテゴリで隠している分は出さない。音楽はミュージックの「ローカル」に出す。中身は useLocalSaveList
 */
export function LocalSaveTab({ text = '' }: { text?: string }) {
  const { t: tx } = useT();
  useBgRenderCount('LocalSaveTab');
  const { pageSize } = useTheme();
  const { viewNode: node } = useViewNode();
  const { ready, active, saved, byId, hidden, offline } = useLocalSaveList(node);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [pageSize, node, text]);

  if (!ready) return <T size={12} dim style={styles.empty}>{tx('common.loading')}</T>;
  // 隠しているかが分かるまでは、カードの返らなかった分を出さない（題名が一瞬見えてしまうため。元と同じ）。
  // 通信が無くて分からない時は、控えた情報で出す（出さないとオフラインで再生に辿り着けない）
  const shownSaved = saved.filter((it) => {
    if (hidden?.has(it.id)) return false;
    const c = byId?.[it.id];
    if (c?.media_kind === 'audio') return false;
    if (byId && !c && !hidden && !offline) return false;
    return true;
  });
  if (!active.length && !shownSaved.length) return <T size={12} dim style={styles.empty}>{tx('library.localSaveTab.noVideosSavedOffline')}</T>;
  // 絞込（タイトルは控えた情報とカードの両方で見る）
  const q = text.toLowerCase();
  const match = (it: LocalItem) => {
    const c = byId?.[it.id];
    if (!q) return true;
    return [c?.eit_title, c?.episode_name, c?.series_name, it.title, it.episodeName, it.series].some((v) => !!v && v.toLowerCase().includes(q));
  };
  const fActive = active.filter(match);
  const fSaved = shownSaved.filter(match);
  if (text && byId && !fActive.length && !fSaved.length) return <T size={12} dim style={styles.empty}>{tx('library.localSaveTab.noOfflineVideosMatch')}</T>;
  const rows: ({ k: 'a'; it: ActiveItem } | { k: 'c'; it: LocalItem })[] = [
    ...fActive.map((it) => ({ k: 'a' as const, it })), ...fSaved.map((it) => ({ k: 'c' as const, it })),
  ];
  const pg = paginate(rows, page, pageSize);
  const pager = <PagerBar page={pg.page} totalPages={pg.totalPages} totalCount={rows.length}
    onPrev={() => setPage(Math.max(0, pg.page - 1))} onNext={() => setPage(Math.min(pg.totalPages - 1, pg.page + 1))} />;
  return (
    <View style={styles.list}>
      {pager}
      {pg.items.map((r) => {
        if (r.k === 'a') return <ActiveRow key={`a${r.it.id}`} it={r.it} />;
        const c = byId?.[r.it.id];
        if (c && offline) return <OfflineCard key={r.it.id} it={r.it} c={c} node={node} />;
        if (c) return <VideoCard key={r.it.id} video={c} node={node} contextLabel={videoContextLabel(c)} onPlay={() => playLocal(r.it)} />;
        return <SavedRow key={r.it.id} it={r.it} />;
      })}
      <View style={styles.bottom}>{pager}</View>
    </View>
  );
}

/** 通信の無い時: 控えたカードで、サムネは端末に保存したもの */
function OfflineCard({ it, c, node }: { it: LocalItem; c: LocalCard; node: string | null }) {
  const poster = useLocalPoster(it.id, it.node);
  return <VideoCard video={c} node={node} contextLabel={videoContextLabel(c)} onPlay={() => playLocal(it)} thumb={poster ? { uri: poster } : null} />;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 18, gap: 8 },
  empty: { textAlign: 'center', padding: 40 },
  bottom: { paddingTop: 4 },
});
