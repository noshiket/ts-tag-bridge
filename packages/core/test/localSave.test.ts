import { describe, expect, it } from 'vitest';

import { captionTrackKeys, localKey, localSaveMetaOf, localSaveMime, parseLocalKey, sidecarComments, sortLocalItems, type StreamMeta, type Video } from '../src';

describe('ローカル保存', () => {
  it('保存できる形式は拡張子で決める（TS は保存できない）', () => {
    expect(localSaveMime('/a/b.MKV')).toBe('video/x-matroska');
    expect(localSaveMime('/a/b.mp4')).toBe('video/mp4');
    expect(localSaveMime('/a/b.ts')).toBe('');
    expect(localSaveMime(null)).toBe('');
  });
  it('鍵: 自サーバーは番号だけ、他のサーバーは「サーバー~番号」', () => {
    expect(localKey(12, null)).toBe('12');
    expect(localKey(12, 'node2')).toBe('node2~12');
    expect(parseLocalKey('12')).toEqual({ id: 12, node: null });
    expect(parseLocalKey('node2~12')).toEqual({ id: 12, node: 'node2' });
  });
  it('控える情報', () => {
    const v = { eit_title: 'T', episode_number: '3', episode_name: 'N', file_path: 'x.mp4', onid: 1, sid: 2, eit_station_name: 'S',
      has_caption: 1, comment_count: 5, max_comment_count: 9, duration_sec: 60, eit_start_time: 'e', recording_start_time: 'r' } as Video;
    expect(localSaveMetaOf(v, 'Ser')).toMatchObject({ title: 'T', series: 'Ser', episodeNum: '3', mime: 'video/mp4', hasCaption: true, commentCount: 9 });
  });
  it('補助データ: 実況は古い配列の形も読む、字幕のトラックは無ければ 1・2', () => {
    const c = [{ time: 1, text: 'a', color: '', type: '', author: '', date: '' }];
    expect(sidecarComments({ comments: c })).toEqual({ comments: c });
    expect(sidecarComments({ comments: { comments: c } })).toEqual({ comments: c });
    // 外から取り込んだコメント（追加のトラック）も残す
    const t = { '取り込み': [{ time: 2, text: 'b', color: '', type: 'right', author: '', date: '' }] };
    expect(sidecarComments({ comments: { comments: c, tracks: t } })).toEqual({ comments: c, tracks: t });
    expect(captionTrackKeys(null)).toEqual(['1', '2']);
    expect(captionTrackKeys({ caption_tracks: [{ key: 'x' }] } as unknown as StreamMeta)).toEqual(['x']);
  });
  it('新しい順', () => {
    expect(sortLocalItems([{ cachedAt: '2026-01-01' }, { cachedAt: '2026-02-01' }]).map((x) => x.cachedAt)).toEqual(['2026-02-01', '2026-01-01']);
  });
});
