import { describe, expect, it } from 'vitest';

import { activeCommentIndex, mergeWatchEntry, posToTot, resumePosition, totToPos, watchEntryFor, watchProgressByVideo, type TimingMeta, type WatchEntry } from '../src';

const T = (s: string) => Date.parse(`2026-11-07T09:${s}+09:00`);

// 30:00〜31:00 と 33:00〜35:00 を切り出した動画（間の2分は CM で切った）。
// 34:00 から 10 秒、受信が途切れた
const meta: TimingMeta = {
  duration: 170,
  trim_segments: [
    { start: '2026-11-07T09:30:00+09:00', end: '2026-11-07T09:31:00+09:00', duration_sec: 60 },
    { start: '2026-11-07T09:33:00+09:00', end: '2026-11-07T09:35:00+09:00', duration_sec: 110 },
  ],
  pts_gaps: [{ start_tot: '2026-11-07T09:34:00+09:00', lost_sec: 10 }],
};

describe('再生位置と放送時刻', () => {
  it('区間をつないだ位置になる', () => {
    expect(totToPos(meta, T('30:30'))).toBe(30);
    expect(totToPos(meta, T('33:30'))).toBe(90);
    expect(posToTot(meta, 90)).toBe(T('33:30'));
  });

  it('切った CM の中は次の区間の頭へ寄せる。最後より後は尺', () => {
    expect(totToPos(meta, T('32:00'))).toBe(60);
    expect(totToPos(meta, T('59:00'))).toBe(170);
  });

  it('受信が途切れた分は放送時刻だけ進む', () => {
    expect(totToPos(meta, T('34:30'))).toBe(60 + 90 - 10);
    expect(posToTot(meta, 140)).toBe(T('34:30'));
  });

  it('区間が無ければ録画開始からの経過', () => {
    const m: TimingMeta = { duration: 600, recording_start_time: '2026-11-07T09:30:02+09:00' };
    expect(totToPos(m, T('31:02'))).toBe(60);
    expect(posToTot(m, 60)).toBe(T('31:02'));
  });

  it('保存した形から続きの位置に戻る（放送時刻で持てない動画は秒で）', () => {
    const v = { id: 5, title: 't' };
    const e = watchEntryFor(meta, v, 90, 170);
    expect(e.fileKey).toBe('video:5');
    expect(e.resumeTot).toBe(new Date(T('33:30')).toISOString());
    expect(e.pos).toBeNull();
    expect(resumePosition(meta, e)).toBe(90);
    const plain = watchEntryFor({ duration: 100 }, v, 42, 100);
    expect(plain.resumeTot).toBeNull();
    expect(resumePosition({ duration: 100 }, plain)).toBe(42);
  });
});

describe('今のコメント', () => {
  it('再生位置以下の最後のもの', () => {
    const cs = [{ time: 1 }, { time: 2 }, { time: 2 }, { time: 5 }];
    expect(activeCommentIndex(cs, 0.5)).toBe(-1);
    expect(activeCommentIndex(cs, 2)).toBe(2);
    expect(activeCommentIndex(cs, 4.9)).toBe(2);
    expect(activeCommentIndex(cs, 99)).toBe(3);
  });
});

describe('mergeWatchEntry / watchProgressByVideo', () => {
  const e = (fileKey: string, progress: number, lastType = 'video'): WatchEntry => ({
    fileKey, lastType, lastId: fileKey.split(':')[1]!, onid: null, tsid: null, sid: null, eid: null, eitStart: null,
    title: '', episodeNum: null, episodeName: null, progress, resumeTot: null, pos: null, updatedAt: '',
  });
  it('同じ動画は置き換えて頭へ、他はそのまま', () => {
    const merged = mergeWatchEntry([e('video:1', 0.1), e('video:2', 0.2)], e('video:2', 0.5));
    expect(merged.map((x) => [x.fileKey, x.progress])).toEqual([['video:2', 0.5], ['video:1', 0.1]]);
  });
  it('動画だけを番号で引ける（録画や 0 は入れない）', () => {
    const m = watchProgressByVideo([e('video:1', 0.3), e('recording:5', 0.4, 'recording'), e('video:2', 0)]);
    expect([...m]).toEqual([[1, 0.3]]);
  });
});

describe('続きを見る', () => {
  it('同じ鍵は新しい方だけ・新しい順・カードを出せるか', async () => {
    const { continueList, isVideoEntry } = await import('../src');
    const e = (fileKey: string, lastId: string, updatedAt: string, lastType = 'video') => ({ fileKey, lastType, lastId, updatedAt }) as never;
    const l = continueList([e('video:1', '1', '2026-11-01'), e('video:2', '2', '2026-11-03'), e('video:1', '1', '2026-11-05'), e('', '9', '2026-11-02', 'recording')]);
    expect(l.map((x: { lastId: string; updatedAt: string }) => `${x.lastId}@${x.updatedAt}`)).toEqual(['1@2026-11-05', '2@2026-11-03', '9@2026-11-02']);
    expect([isVideoEntry(e('video:1', '1', '')), isVideoEntry(e('video:x', 'lark:3', '')), isVideoEntry(e('', '3', '', 'recording'))]).toEqual([true, false, false]);
  });
});
