"""既存のシークバー用タイル画像を、iOS でもデコードできる幅に組み替える。

新規に生成する分は thumbnail_generator.py の WEBP_MAX_TILE_ROW_WIDTH で
既に対応済み（幅8192px以下になる）。ここは**既存の録画**（幅16320px、
WEBP_MAX_SIZEの旧上限いっぱいで生成されたもの）を対象にする。

iOS(WKWebView の WebP デコーダ)は幅16320pxの画像をデコードできず、
makeImagePlus: err=-50 で失敗し続ける。デスクトップの Chrome/Safari は
問題なく開ける。

方針: 元のタイル画像・生成コード・DBには一切触れない。行を跨いで
タイルを詰め直すだけの別ファイルを作り、iOS向けエンドポイントでだけ配る
（server/api/routes.py の thumbnail-tile-ios）。組み替えは通し番号
(row-major)を保つだけなので、Web側は既存の meta.thumbnail_info.tile から
同じ計算で列・行を導ける（このモジュールへ問い合わせる必要がない）。
"""

import logging
import pathlib

import cv2
import numpy as np

logger = logging.getLogger(__name__)

TILE_W, TILE_H = 320, 180          # thumbnail_generator.TILE_SCALE と同じ値
MAX_ROW_WIDTH = 8192               # thumbnail_generator.WEBP_MAX_TILE_ROW_WIDTH と同じ値
WEBP_QUALITY = 71                  # thumbnail_generator.WEBP_QUALITY_TILE と同じ値
SUFFIX = '.thumbnail_tile_ios.webp'


def ios_cache_path(original_tile_path: str) -> pathlib.Path:
    """元のタイル画像パスから、iOS向けキャッシュの置き場所を決める。"""
    p = pathlib.Path(original_tile_path)
    stem = p.name[:-len('.thumbnail_tile.webp')] if p.name.endswith('.thumbnail_tile.webp') else p.stem
    return p.with_name(stem + SUFFIX)


def new_layout(old_cols: int, old_rows: int) -> tuple[int, int]:
    """列数・行数だけを Web 側と同じ式で計算する（画像を読まずに済む場合用）。"""
    new_cols = max(1, min(old_cols, MAX_ROW_WIDTH // TILE_W))
    total = old_cols * old_rows
    new_rows = -(-total // new_cols)  # ceil
    return new_cols, new_rows


def build_ios_tile(original_tile_path: str) -> bytes | None:
    """元のタイル画像を読み、iOS向けに組み替えて WebP バイト列を返す。

    失敗したら None（呼び出し側は 404 にする）。生成の重さは
    タイル枚数に比例するが、キャッシュファイルとして書き出すのは
    呼び出し側の責務（ここは変換のみ）。
    """
    img = cv2.imread(original_tile_path, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning('iOS用タイルの組み替えに失敗（読めない）: %s', original_tile_path)
        return None
    h, w = img.shape[:2]
    if w <= MAX_ROW_WIDTH:
        # 既に十分狭い（新規生成分・縦長のコマのタイルなど）。組み替えは不要でそのまま返す
        ok, buf = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
        return buf.tobytes() if ok else None
    if w % TILE_W or h % TILE_H:
        logger.warning('iOS用タイルの組み替えに失敗（寸法がタイル単位でない）: %s (%dx%d)',
                       original_tile_path, w, h)
        return None
    old_cols, old_rows = w // TILE_W, h // TILE_H

    if old_cols <= MAX_ROW_WIDTH // TILE_W:
        # 既に十分狭い（新規生成分など）。組み替えは不要でそのまま返す
        ok, buf = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
        return buf.tobytes() if ok else None

    new_cols, new_rows = new_layout(old_cols, old_rows)

    # 通し番号(row-major)を保ったまま詰め直す。Web側の
    # idx = row*column_count + col という計算とここでの並びが
    # 一致していないと、表示されるプレビュー画像がズレる。
    tiles: list[np.ndarray] = []
    for r in range(old_rows):
        for c in range(old_cols):
            tiles.append(img[r * TILE_H:(r + 1) * TILE_H, c * TILE_W:(c + 1) * TILE_W])
    black = np.zeros((TILE_H, TILE_W, 3), dtype=np.uint8)
    while len(tiles) < new_cols * new_rows:
        tiles.append(black)

    rows = []
    for r in range(new_rows):
        rows.append(cv2.hconcat(tiles[r * new_cols:(r + 1) * new_cols]))
    out = cv2.vconcat(rows)

    ok, buf = cv2.imencode('.webp', out, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
    if not ok:
        logger.warning('iOS用タイルの再エンコードに失敗: %s', original_tile_path)
        return None
    return buf.tobytes()
