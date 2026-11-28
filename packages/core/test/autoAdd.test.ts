import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEARCH_QUERY, adaptAddonAutoAdd, adaptAutoAdd, addonSearchInfo, autoAddBody, autoAddCardSummary, canSaveManuAdd, initAutoAddForm,
  initManuAddForm, manuAddBody, manuAddTimes, pendingFromEvent, pendingFromSearch, previewFromAddon, previewMark, previewReserve,
  previewSearchParams, previewTimeLabel, type AutoAddRaw, type Reserve,
} from '../src';

const raw: AutoAddRaw = {
  id: 7, add_count: 87, disable_flag: false, note: '',
  rec_setting: { recMode: 1, priority: 2 },
  search_info: {
    and_key: 'アニメ', aimai_flag: true, reg_exp_flag: true, chk_rec_day: 6,
    content_list: [{ content_nibble: 1792 }, 1793], service_list: [{ onid: 4, tsid: 16625, sid: 101 }, '4-16592-141'],
  },
};

describe('EPG キーワード自動予約', () => {
  it('EDCB のルールと配信のルールを同じ形に', () => {
    const a = adaptAutoAdd(raw);
    expect(a).toMatchObject({ id: 7, addCount: 87, andKey: 'アニメ', aimaiFlag: true, regExpFlag: true, chkRecDay: 6, contentList: [1792, 1793],
      serviceList: ['4-16625-101', '4-16592-141'], notKey: '', freeCAFlag: 0 });
    expect(autoAddCardSummary(a)).toBe('指定SVC · 通常 · 2ch指定');
    const b = adaptAddonAutoAdd(-1, { search_info: { andKey: 'x', contentList: [{ content_nibble: 1792 }] }, channels: ['abema_guide/a'], enabled: false }, 'streamlink_record');
    expect(b).toMatchObject({ id: -1, addon: 'streamlink_record', disableFlag: true, andKey: 'x', contentList: [1792], serviceList: [] });
    expect(autoAddCardSummary(b)).toBe('配信 1局');
  });
  it('保存の中身: オフ・空も送り、中ジャンルが全部なら大ジャンルにまとめる', () => {
    const f = { ...initAutoAddForm(adaptAutoAdd(raw), null), contentList: [768, 769, 770, 783] };
    const b = autoAddBody(f);
    expect(b).toMatchObject({
      disable_flag: false, note: '', and_key: 'アニメ', not_key: '', case_flag: false, content_list: [{ content_nibble: 1023 }],
      service_list: [{ onid: 4, tsid: 16625, sid: 101 }, { onid: 4, tsid: 16592, sid: 141 }], chk_rec_day: 6, date_list: [], not_date_flag: false,
      rec_mode: 1, priority: 2,
    });
    expect(addonSearchInfo(f, f.contentList).contentList).toHaveLength(4);
  });
  it('検索・番組からの引き継ぎ', () => {
    const p = pendingFromSearch({ ...DEFAULT_SEARCH_QUERY, andkey: 'x', regExp: true, serviceList: ['4-16625-101'], contentList: [768] });
    const f = initAutoAddForm(null, p);
    expect(f).toMatchObject({ andKey: 'x', regExpFlag: true, serviceList: ['4-16625-101'], contentList: [768], recMode: 1, priority: 2 });
    expect(initAutoAddForm(null, pendingFromEvent({ title: '番組', onid: 1, tsid: 2, sid: 3 }))).toMatchObject({ andKey: '番組', serviceList: ['1-2-3'] });
    // 既存のルールがあれば引き継ぎは使わない
    expect(initAutoAddForm(adaptAutoAdd(raw), p).andKey).toBe('アニメ');
  });
  it('試しの検索は番組検索と同じ送り方', () => {
    const f = initAutoAddForm(adaptAutoAdd(raw), null);
    expect(previewSearchParams(f, 14)).toBe('and_key=%E3%82%A2%E3%83%8B%E3%83%A1&reg_exp_flag=1&aimai_flag=1&days=14'
      + '&service=4-16625-101&service=4-16592-141&content=1792&content=1793');
  });
  it('試しの検索の予約は題名と開始の分で見る', () => {
    const p = previewFromAddon({ title: 'A', ch_name: '配信ch', start_time: '2026-11-08 21:00:00', end_time: '2026-11-08 21:30:00', duration_sec: 1800, dup: true });
    expect(p).toMatchObject({ addon: true, dup: true, durationMin: 30, end: p.start + 1800_000 });
    expect(previewTimeLabel(p)).toBe('11-08 21:00 · 30分');
    const r = (o: Partial<Reserve>) => ({ title: 'A', start_time: new Date(p.start + 20_000).toISOString(), rec_enabled: 1, rule_state: null, ...o }) as Reserve;
    expect(previewMark(previewReserve([r({})], p))).toBe('REC');
    expect(previewMark(previewReserve([r({ rec_enabled: 0 })], p))).toBe('SKIP');
    expect(previewReserve([r({ title: 'B' })], p)).toBeUndefined();
  });
});

describe('プログラム予約', () => {
  const m = { id: 10, title: 'もちもち', onid: 32740, tsid: 32740, sid: 1056, start_time: 27000, duration_sec: 1800, day_of_week_flag: 36 };
  it('時刻と編集の始め', () => {
    expect(manuAddTimes(m)).toEqual({ start: '07:30', end: '08:00', durationMin: 30 });
    expect(initManuAddForm(m)).toMatchObject({ service_id: '32740-32740-1056', start_time: '07:30', end_time: '08:00', day_of_week_flag: 36 });
    expect(initManuAddForm(null)).toMatchObject({ service_id: '', day_of_week_flag: 0x7f });
  });
  it('局と時刻が無いと保存できない', () => {
    const f = initManuAddForm(m);
    expect(canSaveManuAdd(f)).toBe(true);
    expect(canSaveManuAdd({ ...f, service_id: '' })).toBe(false);
    expect(canSaveManuAdd({ ...f, end_time: '25:00' })).toBe(false);
    expect(manuAddBody({ ...f, title: '' })).toMatchObject({ title: undefined, service_id: '32740-32740-1056', start_time: '07:30', day_of_week_flag: 36 });
  });
});
