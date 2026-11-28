// シークバーのサムネ: 一定間隔のコマを格子に並べた1枚の画像から、その時刻のコマを切り出す位置
// （元の Web 版と同じ計算）

/** GET /api/streams/vdb/<id>/metadata の thumbnail_info.tile */
export interface ThumbnailTile {
  column_count: number;
  row_count: number;
  tile_width: number;
  tile_height: number;
  image_width: number;
  image_height: number;
  interval_sec: number;
  total_tiles: number;
}

/**
 * iOS 向けに詰め直した画像の列数の上限。サーバーの MAX_ROW_WIDTH(8192) // TILE_W(320) と同じ値
 * （server/logic/thumbnail_tile_reflow.py）。片方だけ変えると位置がずれる
 */
export const REFLOWED_MAX_COLUMNS = 25;

export interface ThumbnailCell {
  /** 画像の中のコマの左上(px、元の大きさ) */
  x: number;
  y: number;
  /** 画像全体の大きさ(px、元の大きさ) */
  imageWidth: number;
  imageHeight: number;
}

/** time 秒のコマの位置。reflowed: iOS 向けに列を詰め直した画像を使う時 */
export function thumbnailCell(tile: ThumbnailTile, time: number, reflowed = false): ThumbnailCell {
  const idx = Math.min(tile.total_tiles - 1, Math.max(0, Math.floor(time / tile.interval_sec)));
  const cols = reflowed ? Math.min(tile.column_count, REFLOWED_MAX_COLUMNS) : tile.column_count;
  const rowsInOriginal = Math.round(tile.image_height / tile.tile_height);
  return {
    x: (idx % cols) * tile.tile_width,
    y: Math.floor(idx / cols) * tile.tile_height,
    imageWidth: reflowed ? cols * tile.tile_width : tile.image_width,
    imageHeight: reflowed ? Math.ceil((tile.column_count * rowsInOriginal) / cols) * tile.tile_height : tile.image_height,
  };
}
