import { continueList, isVideoEntry, paginate, shortDateTime, watchKey, type WatchEntry } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { notify } from '../../lib/device/confirm';
import { useViewNode } from '../../lib/state/viewNode';
import { Trash } from '../../ui/parts/Icons';
import { PagerBar } from '../../ui/parts/PagerBar';
import { ReelThumb, hueFromId } from '../../ui/parts/ReelThumb';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { VideoCard } from './VideoCard';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * 続きを見る（元の encode.jsx の ContinueWatchingList）: 動画の視聴履歴を新しい順に。動画はライブラリと同じカード
 * （右上の ✕ で履歴から消す）、録画などカードを出せないものは小さい行。非公開のカテゴリで隠している動画は出さない。
 * 録画は同じ番組をエンコードした動画があればそちらを開き、無ければ録画のまま再生する（元と同じ）
 */
export function ContinueTab() {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, pageSize } = useTheme();
  const { viewNode } = useViewNode();
  const hist = useQuery({ queryKey: ['watchHistory', 'video'], queryFn: async () => continueList(await api.watch.videos()) });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [pageSize]);
  const items = (hist.data ?? []).filter((e) => !removed.has(watchKey(e)) && !(e.lastType === 'video' && hidden.has(String(e.lastId))));
  const p = paginate(items, page, pageSize);
  const ids = useMemo(() => p.items.filter(isVideoEntry).map((e) => Number(e.lastId)), [p.items]);
  const cards = useQuery({
    queryKey: ['library', viewNode ?? '', 'cards', ids.join(',')],
    queryFn: async () => new Map((await api.library.videoCards(ids, viewNode)).map((v) => [v.id, v])),
  });
  // カードが取れない動画: 非公開のカテゴリで隠しているなら外す（題名も出さない）
  useEffect(() => {
    if (!cards.data) return;
    const missing = ids.filter((id) => !cards.data.has(id));
    if (!missing.length) return;
    api.library.privateHidden(missing, viewNode).then((h) => h.length && setHidden((prev) => new Set([...prev, ...h.map(String)]))).catch(() => {});
  }, [cards.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (e: WatchEntry) => {
    setRemoved((prev) => new Set(prev).add(watchKey(e)));
    void api.watch.remove(watchKey(e)).finally(() => qc.invalidateQueries({ queryKey: ['watchHistory'] }));
  };
  const open = async (e: WatchEntry) => {
    // 録画でも、同じ番組をエンコードした動画があればそちらを開く（続きの位置は放送時刻から合わせる）
    let id = isVideoEntry(e) ? Number(e.lastId) : null;
    if (id == null && e.onid != null && e.sid != null) {
      try { id = await api.library.resolveVideo({ onid: e.onid, tsid: e.tsid, sid: e.sid, eid: e.eid, eitStart: e.eitStart, tot: e.resumeTot }); } catch { /* 無い */ }
    }
    if (id != null) { router.push({ pathname: '/watch/[id]', params: { id: String(id) } }); return; }
    // 他のサーバーの録画は「ノード:番号」で持っている（再生画面の視聴履歴の保存と同じ形）
    const raw = String(e.lastId);
    const at = raw.lastIndexOf(':');
    const recId = Number(at >= 0 ? raw.slice(at + 1) : raw);
    if (e.lastType !== 'recording' || !Number.isFinite(recId)) { notify(tx('library.continueTab.historyItemCantOpened')); return; }
    router.push({ pathname: '/watch/[id]', params: { id: String(recId), kind: 'rec', ...(at >= 0 ? { node: raw.slice(0, at) } : {}) } });
  };
  const pager = <PagerBar page={p.page} totalPages={p.totalPages} totalCount={items.length}
    onPrev={() => setPage(p.page - 1)} onNext={() => setPage(p.page + 1)} />;

  if (!hist.data) return <T size={12} dim style={styles.empty}>{hist.error ? hist.error.message : tx('common.loading')}</T>;
  if (!items.length) return <T size={12} dim style={styles.empty}>{tx('library.continueTab.nothingContinueWatching')}</T>;
  return (
    <View style={styles.list}>
      {pager}
      {p.items.map((e) => {
        const card = isVideoEntry(e) ? cards.data?.get(Number(e.lastId)) : undefined;
        if (isVideoEntry(e) && !cards.data) return null; // カードを読んでいる間
        if (card) {
          return (
            <View key={watchKey(e)}>
              <VideoCard video={card} node={viewNode} albumName={card.album_name ?? undefined}
                onPlay={() => router.push({ pathname: '/watch/[id]', params: { id: String(card.id) } })} />
              <Pressable onPress={() => remove(e)} accessibilityLabel={tx('library.continueTab.removeHistory')}
                style={[styles.x, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <T size={11} dim>✕</T>
              </Pressable>
            </View>
          );
        }
        return <CompactRow key={watchKey(e)} e={e} onOpen={() => void open(e)} onRemove={() => remove(e)} />;
      })}
      {pager}
    </View>
  );
}

/** カードを出せない履歴の行（元の小さい行）: サムネ・題名・進み具合・種類と日時 */
function CompactRow({ e, onOpen, onRemove }: { e: WatchEntry; onOpen: () => void; onRemove: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const pct = Math.round((e.progress || 0) * 100);
  const isRec = e.lastType !== 'video';
  // 他のサーバーの録画は 'node:id'
  const [node, rid] = String(e.lastId).includes(':') ? String(e.lastId).split(':') : [null, String(e.lastId)];
  const thumb = isRec ? api.client.url(`${node ? `/api/nodes/${node}` : '/api'}/encode/recordings/${rid}/thumbnail?t=5`) : api.library.videoThumbnailUrl(Number(rid), null);
  return (
    <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.cardFrame, boxShadow: shadow(theme, 2) }]}>
      <Pressable onPress={onOpen} style={styles.rowMain}>
        <ReelThumb source={{ uri: thumb, headers: api.client.authHeaders() }} hue={hueFromId(Number(rid) || 0)} width={46} height={34}>
          {pct > 1 && <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>}
        </ReelThumb>
        <View style={styles.grow}>
          <T size={13} w={700} numberOfLines={1}>{e.title || `${e.lastType}:${e.lastId}`}</T>
          <View style={styles.progRow}>
            <View style={[styles.prog, { backgroundColor: theme.line }]}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: accent.primary }} /></View>
            <T mono size={9} dim>{`${pct}%`}</T>
          </View>
          <T mono size={9} dim>{`${tx(isRec ? 'state.recStep.0' : 'library.album.mode.video')} · ${shortDateTime(e.updatedAt)}${e.playCount ? ` · ${tx('library.music.plays', { n: e.playCount })}` : ''}`}</T>
        </View>
        <T size={13} w={700} color={accent.primary}>▶</T>
      </Pressable>
      <Pressable onPress={onRemove} accessibilityLabel={tx('library.continueTab.removeHistory')} style={[styles.trash, { borderColor: theme.line, backgroundColor: theme.surface }]}>
        <Trash s={13} c={theme.mute} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', padding: 40 },
  list: { paddingHorizontal: 18, gap: 8 },
  x: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1.5 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.35)' },
  barFill: { height: '100%', backgroundColor: '#e53e3e' },
  grow: { flex: 1, minWidth: 0 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  prog: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  trash: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
