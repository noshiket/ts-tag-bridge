import { describe, expect, it } from 'vitest';

import { confirmedFromTag } from '../src/library/confirmedFromTag';

describe('confirmedFromTag', () => {
  it('複数話の解析結果を episode_idx の話へ縮め、確定値と番組の情報を返す', () => {
    const r = confirmedFromTag({
      title: '架空の番組', folder: '架空の番組', episode_number: '2', episode_name: '二話', category: ['架空の番組', '深夜枠'],
      episode_idx: 1, eit_title: '架空の番組 #1-2', sid: 1024, onid: 32736, tsid: 32736, eit_station_name: '架空テレビ',
      eit_start_time: '2026-11-01T01:00:00+09:00', eit_description: '説明', eit_extended_info: '詳細',
      text_parser_result: JSON.stringify({ title: '架空の番組', episode_number: ['1', '2'], episode_name: ['一話', '二話'] }),
    });
    expect(r.confirmed).toMatchObject({ title: '架空の番組', episode_number: '2', episode_name: '二話', category: ['架空の番組', '深夜枠'] });
    expect(r.parseResult).toEqual({ title: '架空の番組', episode_number: '2', episode_name: '二話' });
    expect(r).toMatchObject({ episode_idx: 1, title: '架空の番組 #1-2', sid: 1024, service_name: '架空テレビ', media_kind: null });
  });

  it('解析結果が無くても空で返す', () => {
    expect(confirmedFromTag({}).parseResult).toEqual({});
  });
});
