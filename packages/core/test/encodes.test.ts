import { describe, expect, it } from 'vitest';

import { encodeProgress, encodeRowFromAddon, encodeRowFromJob, encodeStatus, retryStatesFor, splitEncodes, type EncodeJob, type EncodeRow } from '../src';

describe('encodeStatus / encodeProgress', () => {
  it('工程から状態', () => {
    expect(encodeStatus('wait_encode')).toBe('queued');
    expect(encodeStatus('split_ts')).toBe('queued');
    expect(encodeStatus('file_copy')).toBe('running');
    expect(encodeStatus('encode_end')).toBe('done');
    expect(encodeStatus('encoding', '失敗')).toBe('error');
  });
  it('進み具合', () => {
    expect(encodeProgress('wait_encode', 0.7)).toBe(0);
    expect(encodeProgress('encoding', 1.4)).toBe(1);
    expect(encodeProgress('file_copy', 0.9)).toBe(0.9);
    expect(encodeProgress('encode_end', 0)).toBe(1);
  });
  it('アドオンの仕事も同じ形に', () => {
    const r = encodeRowFromAddon({ encId: 9, addon: 'hevc', videoId: 3, title: '', folder: '', state: 'encoding', priority: 3, progress: 0.5, errorMessage: '', updatedAt: null });
    expect([r.id, r.isAddon, r.title, r.status, r.preset]).toEqual([9, true, 'video 3', 'running', 'hevc']);
  });
});

describe('splitEncodes', () => {
  const row = (id: number, status: EncodeRow['status'], p: Partial<EncodeRow> = {}): EncodeRow => ({
    id, isAddon: false, recordingId: id, videoId: null, title: '', episodeNumber: '', sid: null, state: '', status,
    progress: 0, priority: 3, errorMessage: '', preset: '', encodeDir: '', folder: '', episodeName: '', onid: null, failedState: null,
    addonStep: null, outputPath: '', trimSegments: [], startedAt: '', finishedAt: '', updatedAt: '', encodingStartedAt: '', ...p,
  });
  it('キューは実行中 → 優先度の高い順 → 番号の小さい順', () => {
    const s = splitEncodes([row(5, 'queued'), row(2, 'queued', { priority: 2 }), row(7, 'running'), row(3, 'queued', { priority: 5 }), row(1, 'queued')]);
    expect(s.queue.map((e) => e.id)).toEqual([7, 3, 1, 5, 2]);
    expect([s.running, s.waiting]).toEqual([1, 4]);
  });
  it('履歴はエラーが先、後は新しい順', () => {
    const s = splitEncodes([
      row(1, 'done', { updatedAt: '2026-11-07T10:00' }), row(2, 'error', { updatedAt: '2026-11-01' }), row(3, 'done', { updatedAt: '2026-11-07T12:00' }),
    ]);
    expect(s.history.map((e) => e.id)).toEqual([2, 3, 1]);
    expect([s.done, s.errors]).toEqual([2, 1]);
  });
});

describe('進捗画面', () => {
  it('やり直せる工程は失敗した工程まで', () => {
    expect(retryStatesFor('encoded_analyze')).toEqual(['split_ts', 'encoding', 'encoded_analyze']);
    expect(retryStatesFor(null)).toEqual(['split_ts', 'encoding', 'encoded_analyze', 'file_copy']);
    expect(retryStatesFor('make_DB')).toHaveLength(4);
  });
  it('切り出した区間は文字列でも読み、壊れていれば無し', () => {
    const base = { id: 1, state: 'encode_end', progress: 1 } as EncodeJob;
    const seg = { start: 'a', end: 'b', duration_sec: 3 };
    expect(encodeRowFromJob({ ...base, trim_segments: JSON.stringify([seg]) }).trimSegments).toEqual([seg]);
    expect(encodeRowFromJob({ ...base, trim_segments: '{' }).trimSegments).toEqual([]);
    expect(encodeRowFromJob({ ...base, recording_start_time: 'r', analyzed_recording_start_time: '' }).startedAt).toBe('r');
  });
});
