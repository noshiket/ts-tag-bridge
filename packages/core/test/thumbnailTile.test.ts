import { describe, expect, it } from 'vitest';

import { thumbnailCell, type ThumbnailTile } from '../src/stream/thumbnailTile';

// 旧い仕様の幅広の画像（51 列 × 6 行 = 16320px）
const wide: ThumbnailTile = {
  column_count: 51, row_count: 6, tile_width: 320, tile_height: 180,
  image_width: 16320, image_height: 1080, interval_sec: 5, total_tiles: 300,
};
// 今の仕様（25 列。ポコロ隊長☆ #6 の実際の値）
const now: ThumbnailTile = {
  column_count: 25, row_count: 12, tile_width: 320, tile_height: 180,
  image_width: 8000, image_height: 2160, interval_sec: 5, total_tiles: 287,
};

describe('thumbnailCell', () => {
  it('時刻 ÷ 間隔 のコマを、列数で折り返した位置から取る', () => {
    expect(thumbnailCell(now, 0)).toEqual({ x: 0, y: 0, imageWidth: 8000, imageHeight: 2160 });
    expect(thumbnailCell(now, 124.9)).toMatchObject({ x: 24 * 320, y: 0 }); // 24 コマ目は 1 行目の右端
    expect(thumbnailCell(now, 125)).toMatchObject({ x: 0, y: 180 }); // 25 コマ目で次の行へ
  });

  it('範囲の外は最初と最後のコマ', () => {
    expect(thumbnailCell(now, -3)).toMatchObject({ x: 0, y: 0 });
    // 最後は 286 コマ目 = 11 行目の 11 列目
    expect(thumbnailCell(now, 99999)).toMatchObject({ x: 11 * 320, y: 11 * 180 });
  });

  it('iOS 向けに詰め直した画像では 25 列で数え直す（幅広の旧い画像）', () => {
    // 60 コマ目: 元は 1 行目の 9 列目、詰め直すと 2 行目の 10 列目
    expect(thumbnailCell(wide, 300)).toMatchObject({ x: 9 * 320, y: 180 });
    expect(thumbnailCell(wide, 300, true)).toEqual({ x: 10 * 320, y: 2 * 180, imageWidth: 8000, imageHeight: 13 * 180 });
  });

  it('もとから 25 列なら詰め直しても同じ', () => {
    expect(thumbnailCell(now, 777, true)).toEqual(thumbnailCell(now, 777));
  });
});
