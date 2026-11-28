import { describe, expect, it } from 'vitest';

import { autoCuts, buildSegmentsIndexed, buildSplitSource, fmtDur, fmtMs, frameNo, segmentsFrom, trimFramePreview } from '../src';

const rec = (segments: string[], extra: Record<string, unknown> = {}) =>
  buildSplitSource({ id: 1, db_rec_id: 9, title: 'T', rec_file_path: '/a/b.ts', duration_sec: 3600, segments, confirmed: null, ...extra });

describe('分割の元', () => {
  it('保存済みの segments から切れ目・採用区間・SKIP・無音・チャプター名を読む', () => {
    const s = rec([
      '00:00:00.000-00:30:00.000,keep(00:00:10.000-00:10:00.000@A),keep(00:12:00.000-00:29:00.000),chap(00:12:00.000@B),mute(00:05:00.000-00:05:01.500)',
      '00:30:00.000-01:00:00.000,SKIP',
    ]);
    expect(s.initialCuts).toEqual([1800]);
    expect(s.initialKeepList[0]).toEqual([{ from: 10, to: 600, name: 'A' }, { from: 720, to: 1740, name: '' }]);
    expect(s.initialChapNames[0]).toEqual({ '720.000': 'B' });
    expect(s.initialMutes[0]).toEqual([{ from: 300, to: 301.5 }]);
    expect(s.initialSkips).toEqual({ 1: true });
    expect([s.episodeCount, s.dbRecId, s.name]).toEqual([2, 9, 'b.ts']);
  });
  it('旧い trim(除去区間) は補集合の採用区間へ揃える', () => {
    const s = rec(['00:00:00.000-00:10:00.000,trim(00:01:00.000-00:02:00.000)']);
    expect(s.initialKeepList[0]).toEqual([{ from: 0, to: 60 }, { from: 120, to: 600 }]);
  });
  it('ドロップは3秒以内の続きをまとめる', () => {
    const s = rec([], { drop_error: { total_packets: 100, errors: [{ packet_number: 10 }, { packet_number: 10.05 }, { packet_number: 50 }] } });
    expect(s.dropRanges.length).toBe(2);
  });
});

describe('切れ目と保存の形', () => {
  it('interval と話数から自動の切れ目（余りは後ろ / 前）', () => {
    expect(autoCuts(3700, 2, 30, 'end')).toEqual([1800, 3600]);
    expect(autoCuts(3700, 2, 30, 'start')).toEqual([100, 1900]);
  });
  it('読んだ segments をそのまま書き戻せる', () => {
    const segs = ['00:00:00.000-00:30:00.000,keep(00:00:10.000-00:10:00.000@A),mute(00:05:00.000-00:05:01.500),chap(00:12:00.000@B)', '00:30:00.000-01:00:00.000,SKIP'];
    const s = rec(segs);
    const out = buildSegmentsIndexed({
      segments: segmentsFrom(s.initialCuts, [0], 0, 3600), noRemainder: true, remainderAt: 'end',
      skipList: s.initialSkips, keepList: s.initialKeepList, manualMutes: s.initialMutes, chapNames: s.initialChapNames,
    });
    expect(out).toEqual(segs);
  });
  it('余りの話は null（添字はずらさない）', () => {
    const out = buildSegmentsIndexed({ segments: segmentsFrom([100, 1900], [0, 0], 0, 3700), noRemainder: false, remainderAt: 'start', skipList: {}, keepList: {}, manualMutes: {}, chapNames: {} });
    expect(out[0]).toBeNull();
    expect(out[1]).toBe('00:01:40.000-00:31:40.000');
  });
  it('時刻とコマ番号の書き方', () => {
    expect(fmtMs(3723.5)).toBe('01:02:03.500');
    expect([fmtDur(3723), fmtDur(125), fmtDur(5)]).toEqual(['1h 2m', '2m 5s', '5s']);
    expect(frameNo(1)).toBe(29);
    expect(trimFramePreview(0, 1)).toBe('#0-28');
  });
});

describe('CM解析のブロック', async () => {
  const { blocksIn, cmKeepsFor, cmRanges, flipBlocks, isKeptBlock, segMarks, toOutTime, nearestMark, muteJump } = await import('../src');
  const cm = {
    trim_segments: [{ start: 10, end: 100 }, { start: 130, end: 200 }],
    jls_segments: [{ start: 0, end: 10, label: 'Nologo' }, { start: 10, end: 100, label: 'L' }, { start: 100, end: 130, label: 'CM' }, { start: 130, end: 200, label: 'L' }],
    mutes: [{ start: 49, end: 51, scene_sec: 50.5 }, { start: 49, end: 51, scene_sec: 50.5 }],
    scenes_all: [{ sec: 50.51 }, { sec: 70 }],
    smartcut_cm: [{ start: 100.1, end: 129 }],
  };
  const s = { start: 0, end: 200 };
  it('CM は残す区間の補集合', () => expect(cmRanges(cm, 210)).toEqual([[0, 10], [100, 130], [200, 210]]));
  // smartcut_cm アドオンが名乗る印（server/addon/smartcut_cm/main.py の marks と同じ）
  const smartcut = { key: 'smartcut_cm', kind: 'range', label: 'SmartCut の CM', short: 'SmartCut', jump: true };
  it('▼は重複を畳み、近い切り替わりとアドオンの印（SmartCut）を足して飛び先で並べる', () => {
    expect(segMarks(cm, s).map(muteJump)).toEqual([50.5, 70]);   // 名乗りが無ければアドオンの印は足さない
    const m = segMarks(cm, s, [smartcut]);
    expect(m.map(muteJump)).toEqual([50.5, 70, 100.1, 129]);
    expect(m[2]!.by?.key).toBe('smartcut_cm');
    expect(nearestMark(m, 68)).toBe(1);
  });
  it('ブロックはチャプターの境目と無音の真ん中で区切る', () => {
    const b = blocksIn(cm, s, [{ from: 150, to: 152 }]);
    expect(b.map((x) => [x.start, x.end, x.label])).toEqual([[0, 10, 'Nologo'], [10, 50, 'L'], [50, 100, 'L'], [100, 130, 'CM'], [130, 151, 'L'], [151, 200, 'L']]);
  });
  it('押すと反転し、隣り合う採用は1つにまとまる（名前は引き継ぐ）', () => {
    const b = blocksIn(cm, s);
    expect(b.every((x) => isKeptBlock([], x))).toBe(true);
    const k1 = flipBlocks(b, [], (x) => x.label === 'CM' || x.label === 'Nologo');
    expect(k1).toEqual([{ from: 10, to: 100 }, { from: 130, to: 200 }]);
    const k2 = flipBlocks(b, [{ from: 10, to: 100, name: 'OP' }, { from: 130, to: 200 }], (x) => x.label === 'CM');
    expect(k2).toEqual([{ from: 10, to: 200, name: 'OP' }]);
  });
  it('CM反映は手で足した無音で割る', () => {
    expect(cmKeepsFor(cm, { start: 0, end: 150 }, [{ from: 59, to: 61 }])).toEqual([{ from: 10, to: 60 }, { from: 60, to: 100 }, { from: 130, to: 150 }]);
  });
  it('元の時間 → 出力の時間', () => {
    expect(toOutTime([{ from: 10, to: 100 }, { from: 130, to: 200 }], 0, 140)).toBe(100);
    expect(toOutTime([{ from: 10, to: 100 }], 0, 110)).toBeNull();
  });
});
