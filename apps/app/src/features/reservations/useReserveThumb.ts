import { reserveFolderNames, type AlbumSummary, type Reserve } from '@tstag/core';
import { useAlbums, useApi } from '@tstag/core/react';
import { useCallback, useMemo } from 'react';

/**
 * 予約のサムネ: 確定値のフォルダと同じ名前のアルバムのサムネを借りる（元と同じ。いつもこのサーバーのライブラリから）。
 * 予約一覧・予約詳細・同時刻の予約で使う。合うアルバムが無ければ null（カードはフィルムの絵）
 */
export function useReserveThumb() {
  const api = useApi();
  const albums = useAlbums(null);
  const byName = useMemo(() => new Map((albums.data ?? []).map((a): [string, AlbumSummary] => [a.name, a])), [albums.data]);
  return useCallback((r: Reserve) => {
    const a = reserveFolderNames(r).map((n) => byName.get(n)).find(Boolean);
    return a ? { uri: `${api.library.albumThumbnailUrl(a.id, null)}?v=${encodeURIComponent(a.latest_video_updated_at ?? '')}`, headers: api.client.authHeaders() } : null;
  }, [byName, api]);
}
