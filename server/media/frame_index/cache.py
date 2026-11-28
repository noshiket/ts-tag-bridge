"""フレーム表のファイルキャッシュ（server/data/frame_index/）"""

import os
from typing import List, Optional, Tuple
from .codec import (  # noqa: F401
    _CLOCK,
    _PTS_CYCLE,
)
from .build import (  # noqa: F401
    build_frame_table,
)
from .lookup import read_first_pts
from .table_file import frame_index_path, save_frame_table, load_frame_table


_MEM_CACHE = {}       # cache_path -> (cache_mtime, frames, first_pts)
_MEM_CACHE_MAX = 4    # 分割画面で同時に触る録画数は少ないため小さくてよい


def get_frame_table_cached(ts_path: str, cache_path: str):
    """get_or_build_frame_table のインメモリLRU(直近数録画分)。

    分割画面はプレイヘッド移動毎に frame/frames API を呼ぶため、リクエスト毎の
    gzipキャッシュ再読込と first_pts 取得(ffprobe起動)の反復を避ける。
    キャッシュファイルの mtime で無効化する。
    """
    try:
        mtime = os.path.getmtime(cache_path)
    except OSError:
        mtime = None
    hit = _MEM_CACHE.get(cache_path)
    if hit and mtime is not None and hit[0] == mtime:
        _MEM_CACHE[cache_path] = _MEM_CACHE.pop(cache_path)  # LRU順を更新(dictの挿入順)
        return hit[1], hit[2]
    frames, first_pts = get_or_build_frame_table(ts_path, cache_path)
    try:
        mtime = os.path.getmtime(cache_path)
    except OSError:
        mtime = None
    _MEM_CACHE[cache_path] = (mtime, frames, first_pts)
    while len(_MEM_CACHE) > _MEM_CACHE_MAX:
        _MEM_CACHE.pop(next(iter(_MEM_CACHE)))
    return frames, first_pts


# ---------------------------------------------------------------------------
# フレーム表のファイルキャッシュ（server/data/frame_index/<rec_id>.fidx.gz）
#   録画ごとに1回だけフル走査し、以降はキャッシュを読む。録画削除時に削除する。
#   格納: gzip( magic 'FIDX' + version + first_pts + count + frames[0] + int32デルタ )
#   デルタは表示順ソート済みで常に 0 以上・6.6h未満のため int32 に収まる。
# ---------------------------------------------------------------------------


def _pts_looks_sane(frames: List[int]) -> bool:
    """展開済みPTSに1周ぶんの飛びが無いか。

    2^33 の半分(約13時間)フレームが飛ぶことは無いので、あればキャッシュを作った
    ときの展開が間違っている。周回のまたぎで並びが前後する録画を、offset を
    足し込む古い実装で作ったキャッシュがこれに当たる(実測)。
    """
    return all(abs(frames[i] - frames[i - 1]) <= _PTS_CYCLE // 2
               for i in range(1, len(frames)))


def get_or_build_frame_table(ts_path: str, cache_path: str,
                             first_pts: Optional[int] = None) -> Tuple[List[int], int]:
    """フレーム表を返す。キャッシュがあれば読み、無ければフル走査して保存する。

    first_pts: 構築時に保存する基準PTS（encode_pipeline._read_head_refs 由来を
        渡すと encode 側と完全一致する）。None なら read_first_pts で補う。

    注: キャッシュに保存された first_pts は「作成時点の定義」の値なので採用しない。
    フレーム表(frames)は絶対PTSのため定義変更の影響を受けず再利用できるが、
    基準の first_pts は常に現在の定義で取り直す（過去に定義が変わった際、古い
    キャッシュを持つ録画だけトリム位置がずれる事故を防ぐ）。
    Raises:
        RuntimeError: frame_index 未対応（H.264/H.265 等）。呼び出し側でフォールバック。
    """
    if os.path.exists(cache_path):
        try:
            frames, cached_fp = load_frame_table(cache_path)
            if not _pts_looks_sane(frames):
                raise ValueError('周回の展開がおかしいキャッシュ')  # 下で作り直す
            if first_pts is None:
                try:
                    first_pts = read_first_pts(ts_path)  # 現在の定義で取り直す
                except Exception:
                    first_pts = cached_fp  # TS不在等で読めなければキャッシュ値で妥協
            return frames, first_pts
        except Exception:
            pass  # キャッシュが壊れていれば作り直す
    frames, half, apid, apts, tots = build_frame_table(ts_path)
    if first_pts is None:
        first_pts = read_first_pts(ts_path)
    save_frame_table(cache_path, frames, first_pts, half, apid, apts, tots)
    return frames, first_pts


def delete_frame_table(rec_id: int, data_dir: str) -> None:
    """録画削除時にフレーム表キャッシュを消す（best-effort）。"""
    try:
        p = frame_index_path(rec_id, data_dir)
        if os.path.exists(p):
            os.remove(p)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 音声（Amatsukaze の amts0.dat FilterAudioFrame に当たるもの）
# ---------------------------------------------------------------------------

AAC_UNIT_SAMPLES = 1024
# 1024サンプル = 90kHz で 1920 ティック
AAC_UNIT_TICKS = AAC_UNIT_SAMPLES * _CLOCK // 48000
