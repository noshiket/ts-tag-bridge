import { describe, expect, it } from 'vitest';

import {
  EMPTY_ALBUM_FILTER, activeFilterCount, albumFacets, filterAndSortAlbums, majorGenres, paginate, toggleSort,
  type AlbumSummary,
} from '../src';

const album = (o: Partial<AlbumSummary> & { id: number; name: string }): AlbumSummary => ({
  description: null, genre: null, categories: [], dirs: [], video_count: 1, folder_mismatch: [],
  folder_mismatch_count: 0, in_mylist: false, earliest_broadcast_at: null, latest_broadcast_at: null,
  latest_video_at: null, latest_video_updated_at: null, latest_watch_at: null, ...o,
});

const A = album({ id: 1, name: 'あ', genre: 'アニメ・特撮 > 国内アニメ, 映画 > アニメ', categories: ['子供'], dirs: ['/d1'], series_names: ['第2期'],
  latest_video_at: '2026-11-01T00:00', latest_broadcast_at: '2026-10-30T09:00+09:00', earliest_broadcast_at: '2026-10-01T09:00+09:00',
  latest_watch_at: '2026-11-05T00:00Z' });
const B = album({ id: 2, name: 'い', genre: 'ドラマ > 国内ドラマ', categories: ['子供', '大人'], dirs: ['/d1', '/d2'],
  latest_video_at: '2026-11-03T00:00', latest_broadcast_at: '2026-11-02T21:00+09:00', earliest_broadcast_at: '2026-11-02T21:00+09:00' });
const C = album({ id: 3, name: 'う', genre: 'アニメ・特撮 > 海外アニメ', latest_video_at: '2026-10-01T00:00',
  latest_watch_at: '2026-11-06T00:00Z', folder_mismatch: ['間違い'] });

const ids = (list: AlbumSummary[]) => list.map((a) => a.id);

describe('アルバム一覧の絞り込み・並び替え', () => {
  it('大ジャンルだけを重複なしで取る', () => {
    expect(majorGenres('アニメ・特撮 > 国内アニメ, 映画 > アニメ, アニメ・特撮 > 海外')).toEqual(['アニメ・特撮', '映画']);
    expect(majorGenres(null)).toEqual([]);
  });

  it('候補は件数の多い順（保存先は名前順）', () => {
    const f = albumFacets([A, B, C]);
    expect(f.genres[0]).toBe('アニメ・特撮');
    expect(f.genreCounts['アニメ・特撮']).toBe(2);
    expect(f.dirs).toEqual(['/d1', '/d2']);
  });

  it('既定は追加の新しい順。分類エラーは常に先頭', () => {
    expect(ids(filterAndSortAlbums([A, B, C], EMPTY_ALBUM_FILTER, 'added', 'desc'))).toEqual([3, 2, 1]);
    expect(ids(filterAndSortAlbums([A, B, C], EMPTY_ALBUM_FILTER, 'added', 'asc'))).toEqual([3, 1, 2]);
  });

  it('視聴順: 見ていないものは向きによらず末尾', () => {
    expect(ids(filterAndSortAlbums([A, B], EMPTY_ALBUM_FILTER, 'watched', 'desc'))).toEqual([1, 2]);
    expect(ids(filterAndSortAlbums([A, B], EMPTY_ALBUM_FILTER, 'watched', 'asc'))).toEqual([1, 2]);
  });

  it('名前順は五十音', () => {
    expect(ids(filterAndSortAlbums([B, A], EMPTY_ALBUM_FILTER, 'name', 'asc'))).toEqual([1, 2]);
  });

  it('ジャンル・保存先・言葉・期間で絞る', () => {
    const f = (o: Partial<typeof EMPTY_ALBUM_FILTER>) => ids(filterAndSortAlbums([A, B, C], { ...EMPTY_ALBUM_FILTER, ...o }, 'name', 'asc'));
    expect(f({ genre: '映画' })).toEqual([1]);
    expect(f({ dir: '/d1' })).toEqual([1, 2]);
    expect(f({ text: 'い' })).toEqual([2]);
    // 言葉は既定でアルバム名・シリーズ名・カテゴリ名の全部に当てる
    expect(f({ text: '第2' })).toEqual([1]);
    expect(f({ text: '大人' })).toEqual([2]);
    // 当てる先を選べる（選ばなかった名前には当てない）
    expect(f({ text: '大人', textIn: ['album', 'series'] })).toEqual([]);
    expect(f({ text: '第2', textIn: ['series'] })).toEqual([1]);
    expect(f({ text: '子供', textIn: ['category'] })).toEqual([1, 2]);
    // 全部外した時は全部に当てる（何も出なくならないように）
    expect(f({ text: '第2', textIn: [] })).toEqual([1]);
    // 期間はアルバム内の [最古, 最新] が重なれば出す
    expect(f({ dateFrom: '2026-11-01' })).toEqual([2]);
    // 放送日の無いアルバム(C)は「〜まで」では落ちない（元の Web 版と同じ。C は分類エラーで先頭）
    expect(f({ dateTo: '2026-10-15' })).toEqual([3, 1]);
  });

  it('選んでいる絞り込みの数', () => {
    expect(activeFilterCount({ ...EMPTY_ALBUM_FILTER, genre: 'x', text: 'y', dateFrom: '2026-01-01', dateTo: '2026-02-01' })).toBe(3);
  });

  it('並び替えをもう一度押すと向きが反転、別のものは既定の向き', () => {
    const d = { added: 'desc', name: 'asc' } as const;
    expect(toggleSort<'added' | 'name'>('added', 'desc', 'added', d)).toEqual({ key: 'added', dir: 'asc' });
    expect(toggleSort<'added' | 'name'>('added', 'desc', 'name', d)).toEqual({ key: 'name', dir: 'asc' });
  });

  it('ページ送りは範囲外を端に寄せる', () => {
    const p = paginate([1, 2, 3, 4, 5], 9, 2);
    expect(p).toEqual({ page: 2, totalPages: 3, items: [5] });
    expect(paginate([], 0, 20)).toEqual({ page: 0, totalPages: 1, items: [] });
  });
});
