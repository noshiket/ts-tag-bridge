import type { Messages } from '../translate';

export const filter = {
  'filter.all': '全て',
  'filter.allStations': '全局',
  'filter.allDates': '全日',
  'filter.with': 'あり ({n})',
  'filter.without': 'なし ({n})',
  'filter.epMulti': '複数話 ({n})',
  'filter.epSingle': '単数話 ({n})',
  'filter.epNone': '定義なし ({n})',
  'filter.errYes': 'エラーあり ({n})',
  'filter.errNo': 'エラーなし ({n})',
  'filter.reset': '絞り込みをリセット',
  'filter.fileYes': '有 ({n})',
  'filter.fileNo': '無 ({n})',
  'filter.unscanned': '未処理 ({n})',
} satisfies Messages;
