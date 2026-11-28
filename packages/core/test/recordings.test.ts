import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REC_FILTERS, activeRecFilterCount, canQueueRecording, clockLabel, commentsPerMin, fileSizeLabel, isQueuedRecording,
  pickDuplicates, recordingTimes, recordingsQuery, sortRecStates, stationsByCount, transferButton, transferStatus,
  type DuplicateVideo,
} from '../src';

describe('recordingsQuery', () => {
  it('既定は「ファイル有」だけ', () => {
    expect(recordingsQuery(DEFAULT_REC_FILTERS, 0, 20)).toBe('page=0&per_page=20&file_exist=yes');
  });
  it('変えた条件だけ載せる（録画の状態 0 も載る）', () => {
    const q = new URLSearchParams(recordingsQuery({ ...DEFAULT_REC_FILTERS, recStatus: 0, station: 'KT-Z', fileExist: 'all', text: 'ポコロ' }, 2, 50));
    expect(Object.fromEntries(q)).toEqual({ page: '2', per_page: '50', station: 'KT-Z', rec_status: '0', q: 'ポコロ' });
  });
  it('数えるのは既定から変えたもの（ファイル有は既定）', () => {
    expect(activeRecFilterCount(DEFAULT_REC_FILTERS)).toBe(0);
    expect(activeRecFilterCount({ ...DEFAULT_REC_FILTERS, fileExist: 'all', drop: 'yes' })).toBe(2);
  });
});

describe('並べ方', () => {
  it('段階は処理の順、知らないものは後ろ', () => {
    expect(sortRecStates(['zzz', 'encode_finish', 'waiting', 'scanning'])).toEqual(['scanning', 'waiting', 'encode_finish', 'zzz']);
  });
  it('局は件数の多い順', () => {
    expect(stationsByCount({ a: 1, b: 3 })).toEqual([['b', 3], ['a', 1]]);
  });
});

describe('pickDuplicates', () => {
  const d = (id: number, sid: number, count: number): DuplicateVideo =>
    ({ id, sid, eit_station_name: `s${sid}`, comment_count: count, duration_sec: 600 });
  it('2件までならそのまま', () => {
    expect(pickDuplicates({ sid: 1, duplicate_info: [d(1, 2, 10), d(2, 3, 10)] }).map((x) => x.id)).toEqual([1, 2]);
  });
  it('勢いが最大のもの、次に同じ局のもの（3件まで）', () => {
    const list = [d(1, 9, 100), d(2, 5, 999), d(3, 9, 50), d(4, 7, 10), d(5, 9, 1)];
    expect(pickDuplicates({ sid: 9, duplicate_info: list }).map((x) => x.id)).toEqual([2, 1, 3]);
  });
  it('勢い', () => {
    expect(commentsPerMin(600, 600)).toBe(60);
    expect(commentsPerMin(null, 600)).toBeNull();
  });
});

describe('録画詳細の表示', () => {
  it('開始・終了と長さ（番組の終わりがあればそれ）', () => {
    const start = new Date(2026, 10, 8, 0, 59, 0).toISOString();
    expect(recordingTimes({ start_time: start, duration_sec: 1800, eit_end_time: null })).toEqual({ start: '2026-11-08 00:59', end: '2026-11-08 01:29', durationMin: 30 });
    const end = new Date(2026, 10, 8, 1, 30, 0).toISOString();
    expect(recordingTimes({ start_time: start, duration_sec: 1800, eit_end_time: end }).durationMin).toBe(31);
  });
  it('大きさ・再生時間・キュー', () => {
    expect([fileSizeLabel(3317702176), fileSizeLabel(500 * 1024 ** 2), fileSizeLabel(0)]).toEqual(['3.1 GB', '500 MB', '']);
    expect(clockLabel(1789.237)).toBe('00:29:49.237');
    expect([canQueueRecording('waiting'), canQueueRecording('queued'), isQueuedRecording('encode_finish')]).toEqual([true, false, true]);
  });
});

describe('別のサーバーへの転送', () => {
  it('ボタンの文字', () => {
    expect(transferButton('node2', null, null).label).toBe('node2 へ転送');
    expect(transferButton('node2', { node: 'node2', phase: 'sending', sent: 1, total: 2 }, null)).toMatchObject({ label: 'node2 へ転送中…', busy: true });
    expect(transferButton('node2', { node: 'node2', phase: 'error', sent: 0, total: 0 }, null)).toMatchObject({ label: 'node2 へ転送をやり直す', failed: true });
    expect(transferButton('node2', { node: 'node2', phase: 'done', sent: 2, total: 2 }, null).label).toBe('node2 へもう一度転送');
    expect(transferButton('other', { node: 'node2', phase: 'sending', sent: 1, total: 2 }, null).busy).toBe(false);
    expect(transferButton('node2', null, 'node2').label).toBe('node2 へ転送を開始中...');
  });
  it('進み具合', () => {
    expect(transferStatus({ node: 'node2', phase: 'sending', sent: 1.2e9, total: 3e9 }).text).toBe('node2 へ転送 · 送信中 1.20GB / 3.00GB (40%)');
    expect(transferStatus({ node: 'node2', phase: 'done', sent: 3e9, total: 3e9 })).toMatchObject({ text: 'node2 へ転送 · 送信完了 3.00GB', done: true });
  });
});
