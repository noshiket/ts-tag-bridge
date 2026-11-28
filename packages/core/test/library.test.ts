import { describe, expect, it } from 'vitest';

import { createApi, episodeTitle, formatBroadcast, formatDuration, nodePath } from '../src';

describe('nodePath', () => {
  it('ノードが無ければそのまま、あれば中継のパスにする', () => {
    expect(nodePath(null, '/api/videos/albums')).toBe('/api/videos/albums');
    expect(nodePath('node1', '/api/videos/albums')).toBe('/api/nodes/node1/videos/albums');
  });
});

describe('libraryApi', () => {
  it('画像の URL は起点と中継を含む', () => {
    const api = createApi({ baseUrl: 'https://s' });
    expect(api.library.videoThumbnailUrl(5)).toBe('https://s/api/videos/5/thumbnail');
    expect(api.library.albumThumbnailUrl(3, 'b')).toBe('https://s/api/nodes/b/videos/albums/3/thumbnail');
  });
});

describe('表示用の整形', () => {
  it('話の見出し', () => {
    expect(episodeTitle({ episode_number: '6', episode_name: '秘密基地', eit_title: 'x' })).toBe('#6 秘密基地');
    expect(episodeTitle({ episode_number: null, episode_name: null, eit_title: '番組' })).toBe('番組');
    expect(episodeTitle({ episode_number: '1', episode_name: '', eit_title: null })).toBe('#1');
  });

  it('尺', () => {
    expect(formatDuration(1434.9)).toBe('23:54');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('');
  });

  it('放送日時は日本時間で出す', () => {
    expect(formatBroadcast('2026-11-07T09:30:00+09:00')).toBe('2026/11/07 (土) 09:30');
    expect(formatBroadcast('2026-11-07T00:30:00Z')).toBe('2026/11/07 (土) 09:30');
    expect(formatBroadcast(null)).toBe('');
  });
});

describe('キャプチャをアルバムごとに', () => {
  it('出てきた順にまとめ、アルバムが無いものは名前を付ける', async () => {
    const { groupCapturesByAlbum } = await import('../src');
    const c = (id: number, album_id: number | null, album: string | null, video_id: number | null) =>
      ({ id, file: `${id}.jpg`, album, album_id, video_id, eit_title: null, tot: null, created_at: null });
    const g = groupCapturesByAlbum([c(1, 5, 'A', 1), c(2, null, null, 3), c(3, 5, 'A', 2), c(4, null, null, null)]);
    expect(g.map((x) => [x.name, x.items.map((i) => i.id)])).toEqual([['A', [1, 3]], ['未分類', [2, 4]]]);
  });
});

describe('解析値を確定値に反映', () => {
  it('確定値の上に解析値。並びは並びのまま、カテゴリは文字か並び', async () => {
    const { videoApplyParseBody } = await import('../src');
    const b = videoApplyParseBody(
      { title: 'A', folder: 'f', episode_number: '1', category: ['x', 'y'], encode_dir: '/mnt' },
      { title: 'B', episode_number: ['7', '8'], 't-episode_name': 'サブ', category: ['c1'] },
    );
    expect(b).toMatchObject({ title: 'B', folder: 'f', episode_number: ['7', '8'], episode_name: 'サブ', category: 'c1', encode_dir: '/mnt', is_text_parser: 1, furigana: '' });
    expect(videoApplyParseBody({ category: 'a, b' }, {}).category).toEqual(['a', 'b']);
    expect(videoApplyParseBody({}, {}).category).toBeNull();
  });
});

describe('動画のアドオンの入力', () => {
  it('始めの値と、空の要る項目', async () => {
    const { addonInitialValues, missingAddonParam } = await import('../src');
    const ps = [{ key: 'url', label: 'URL', required: true }, { key: 'on', label: 'on', type: 'bool' }, { key: 'q', label: 'q', type: 'select', default: 'hi' }];
    const v = addonInitialValues(ps);
    expect(v).toEqual({ url: '', on: false, q: 'hi' });
    expect(missingAddonParam(ps, v)).toBe('URL');
    expect(missingAddonParam(ps, { ...v, url: 'x' })).toBeNull();
  });
});

describe('字幕・コメントの取り込み', () => {
  it('始めの相手・持っているもの・前の解析・言い方', async () => {
    const { addedLabel, hmsToSec, pickDefaultCandidate, reusableRecord, sourceHas } = await import('../src');
    const c = (id: number, o: object) => ({ kind: 'video' as const, id, path: `/v${id}.mp4`, duration_sec: 1800, ...o });
    const a = c(1, { has_caption: false, comment_count: 9000 });
    const b = c(2, { has_caption: true, comment_count: 300 });
    const d = c(3, { has_caption: true, comment_count: 600, duration_gap: 120 });
    expect(pickDefaultCandidate({ videos: [a, b, d] })?.id).toBe(2);
    expect(pickDefaultCandidate({ videos: [d] })?.id).toBe(3);
    expect(pickDefaultCandidate(null)).toBeNull();
    expect(sourceHas(a)).toEqual({ caption: false, comment: true });
    expect(sourceHas(null)).toEqual({ caption: true, comment: true });
    const recs = [{ source: { video_id: 2 }, ranges: [{ a_start: 0, a_end: 1, b_start: 0, b_end: 1, offset: 0 }] }, { source: { video_id: 2 }, ranges: [] }];
    expect(reusableRecord(recs, b)).toBe(recs[0]);
    expect(reusableRecord(recs, a)).toBeNull();
    expect(addedLabel({ comments: { count: 10, name: 'X' }, skipped: { captions: '字幕なし' } })).toBe('コメント 10件(X)（字幕なし）');
    expect(hmsToSec('01:02:03.5')).toBe(3723.5);
  });
});

describe('動画追加', () => {
  it('局を選ぶ・打つ、送る中身、結果の言い方', async () => {
    const { addManualBody, addResultMessage, emptyAddVideoForm, genreOptions, pickService, typeStation } = await import('../src');
    const svcs = [{ onid: 32736, tsid: 32736, sid: 1024, service_name: 'ＱＺＸ総合１' }];
    const f = pickService(emptyAddVideoForm(), svcs, '32736-32736-1024');
    expect(f).toMatchObject({ eit_station_name: 'ＱＺＸ総合１', onid: '32736', sid: '1024' });
    expect(typeStation(f, '配信ch', [{ name: '配信ch', onid: null, tsid: null, sid: 9000 }], svcs)).toMatchObject({ form: { onid: '', sid: '9000' }, key: 'null-null-9000' });
    expect(typeStation(f, '知らない局', [], svcs).form).toMatchObject({ eit_station_name: '知らない局', onid: '', sid: '' });
    expect(addManualBody(f, ['c'], 'keep', true, '/mnt')).toMatchObject({ category: ['c'], place: 'move', encode_dir: '/mnt' });
    expect(genreOptions([{ genre: 'アニメ', sub_genre: null }, { genre: 'アニメ', sub_genre: '国内' }, { genre: 'アニメ', sub_genre: '国内' }])).toEqual(['アニメ', 'アニメ > 国内']);
    expect(addResultMessage({ id: 5, source: 'mp4', captures: 2 })).toEqual({ ok: true, text: '登録しました (video id: 5) — mp4から復元 / キャプチャ2件を紐づけ' });
    expect(addResultMessage({ id: 5, warning: 'AV1' }).ok).toBe(false);
  });
});
