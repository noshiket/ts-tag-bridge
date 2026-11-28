import { describe, expect, it } from 'vitest';

import {
  EMPTY_DETAIL_FILTER, commentDensity, formatDurationJa, dropScrambleCounts, filterAndSortSeries, groupDuplicateVideos,
  hasTelop, oddCodecLabel, stationFacets, type AlbumDetail, type Series, type Video,
} from '../src';

const video = (o: Partial<Video> & { id: number }): Video => ({
  media_kind: null, episode_number: null, episode_name: null, eit_title: null, eit_station_name: null,
  eit_start_time: null, duration_sec: 1440, file_size: null, has_caption: 0, has_secondary_audio: 0,
  comment_count: 0, thumbnail_path: null, artist: null, sort_order: 0, sid: null, onid: null, file_path: null,
  folder: null, folder_mismatch: false, setting: null, eit_audio_info: null, recording_start_time: null,
  created_at: null, updated_at: null, video_codec: null, drop_error: null, announce: null, allow_duplicate: 0,
  has_added_caption: 0, added_comment_tracks: 0, max_comment_count: null, categories: [], ...o,
});
const series = (o: Partial<Series> & { id: number; videos: Video[] }): Series => ({
  album_id: 1, name: `S${o.id}`, furigana: null, sort_order: 0, thumbnail_path: null, created_at: null, updated_at: null, ...o,
});

const detail: AlbumDetail = {
  id: 1, name: 'A', description: null, sort_order: 0,
  series: [
    series({ id: 1, name: 'い', sort_order: 1, created_at: '2026-01-02', videos: [
      video({ id: 11, episode_number: '10', eit_station_name: 'KT−Z', has_caption: 1 }),
      video({ id: 12, episode_number: '2', eit_station_name: 'ひがしテレ' }),
      video({ id: 13, episode_number: null, eit_station_name: 'ひがしテレ' }),
    ] }),
    series({ id: 2, name: 'あ', sort_order: 0, created_at: '2026-01-03', videos: [
      video({ id: 21, episode_number: '1', eit_station_name: 'KT−Z', eit_audio_info: 'デュアルモノ' }),
    ] }),
  ],
};

const ids = (list: Series[]) => list.map((s) => [s.id, s.videos.map((v) => v.id)]);

describe('アルバムの中の絞り込み・並び替え', () => {
  it('既定はシリーズ設定順・話数順（話数の無いものは後ろ）', () => {
    expect(ids(filterAndSortSeries(detail, EMPTY_DETAIL_FILTER, 'manual', 'asc', 'episode', 'asc')))
      .toEqual([[2, [21]], [1, [12, 11, 13]]]);
  });

  it('話数は数として比べる（10 は 2 より後）。降順で逆に', () => {
    expect(ids(filterAndSortSeries(detail, EMPTY_DETAIL_FILTER, 'name', 'desc', 'episode', 'desc')))
      .toEqual([[1, [13, 11, 12]], [2, [21]]]);
  });

  it('局・字幕・副音声で絞り、0件のシリーズは出さない', () => {
    const f = (o: Partial<typeof EMPTY_DETAIL_FILTER>) =>
      ids(filterAndSortSeries(detail, { ...EMPTY_DETAIL_FILTER, ...o }, 'manual', 'asc', 'episode', 'asc'));
    expect(f({ station: 'ひがしテレ' })).toEqual([[1, [12, 13]]]);
    expect(f({ caption: 'yes' })).toEqual([[1, [11]]]);
    expect(f({ audio: 'yes' })).toEqual([[2, [21]]]);
  });

  it('局の候補は多い順', () => {
    const s = stationFacets(detail);
    expect(s.counts).toEqual({ 'KT−Z': 2, 'ひがしテレ': 2 });
    expect(s.stations).toHaveLength(2);
  });

  it('同じ話はまとめ、中はコメントの多い順。話数の無いものはまとめない', () => {
    const vs = [
      video({ id: 1, episode_number: '3', episode_name: 'x', comment_count: 5 }),
      video({ id: 2, episode_number: '3', episode_name: 'x', comment_count: 9 }),
      video({ id: 3 }), video({ id: 4 }),
    ];
    expect(groupDuplicateVideos(vs).map((g) => g.map((v) => v.id))).toEqual([[2, 1], [3], [4]]);
  });
});

describe('ビデオカードの印', () => {
  it('drop は errors から数え、無ければ集計値', () => {
    expect(dropScrambleCounts('{"errors":[{"error_type":"PACKET_LOSS"},{"error_type":"X"}],"drop_count":9,"scramble_count":2}'))
      .toEqual({ drop: 1, scramble: 2 });
    expect(dropScrambleCounts({ errors: [], drop_count: 3 })).toEqual({ drop: 3, scramble: 0 });
    expect(dropScrambleCounts('壊れた')).toBeNull();
  });

  it('告知・勢い・変わったコーデック', () => {
    expect(hasTelop('none(it has pid: 1)')).toBe(false);
    expect(hasTelop('番組内容変更')).toBe(true);
    expect(commentDensity({ comment_count: 2400, max_comment_count: null, duration_sec: 1200 })).toEqual({ count: 2400, perMin: 120, level: 5 });
    expect(commentDensity({ comment_count: 0, max_comment_count: 0, duration_sec: 1200 }).perMin).toBeNull();
    expect(oddCodecLabel('h264')).toBeNull();
    expect(oddCodecLabel('av1')).toBe('AV1');
    expect(formatDurationJa(1434.9)).toBe('23分');
    expect(formatDurationJa(3725)).toBe('1時間2分');
  });
});

import { adjacentEpisode, nextChapterTarget, prevChapterTarget } from '../src';

describe('チャプター送りと隣の話数', () => {
  const chs = [{ name: 'A', sec: 0 }, { name: 'B', sec: 37 }, { name: 'C', sec: 127 }];
  it('次へ: 先のチャプター。最後なら次の話数', () => {
    expect(nextChapterTarget(chs, 10)).toBe(37);
    expect(nextChapterTarget(chs, 36.8)).toBe(127);
    expect(nextChapterTarget(chs, 200)).toBe('nextEpisode');
  });
  it('前へ: 2秒以内は前のチャプター。頭近くなら前の話数', () => {
    expect(prevChapterTarget(chs, 50)).toBe(37);
    expect(prevChapterTarget(chs, 38)).toBe(0);
    expect(prevChapterTarget([], 30)).toBe(0);
    expect(prevChapterTarget(chs, 1)).toBe('prevEpisode');
  });
  it('隣の話数: 同じ話は1つと数え、勢いのある方を選ぶ。端は null', () => {
    const vs = [
      video({ id: 1, episode_number: '1' }),
      video({ id: 2, episode_number: '2', comment_count: 10 }),
      video({ id: 3, episode_number: '2', comment_count: 99 }),
      video({ id: 4, episode_number: '3' }),
    ];
    expect(adjacentEpisode(vs, 1, 1)?.id).toBe(3);
    expect(adjacentEpisode(vs, 2, 1)?.id).toBe(4);
    expect(adjacentEpisode(vs, 4, -1)?.id).toBe(3);
    expect(adjacentEpisode(vs, 4, 1)).toBeNull();
  });
});
