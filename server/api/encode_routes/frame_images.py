"""録画の1コマの絵（同じ絵は覚えておく・同時に作らない）"""

import data_paths
import json
import os
import threading
from collections import OrderedDict
from quart import current_app, abort
from api.routes.auth import bp
from api.routes.parser import _ruledb
from .frame_tables import _ensure_frame_build


@bp.get('/encode/recordings/<int:rec_id>/frame')
def frame_recording(rec_id):
    """指定秒のフレームをリアルタイム生成して返す（キャッシュ無視）。"""
    from quart import request as _req, Response
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    from media.probe.frame_grab import get_frame_by_pts
    from media.probe.thumbnail_grab import get_thumbnail
    try:
        t = float(_req.args.get('t', 5.0))
    except ValueError:
        t = 5.0
    # 解析が出した位置は**フレーム番号**なので、その番号のまま受ける。
    # 秒に直して渡されると、こちらで番号へ引き直す時にずれる
    # （秒は3桁で保存され、その時刻以降の最初のフレームを返すため、
    #  実測で scenes 148件中79件が1つ後ろのフレームになっていた）。
    try:
        want_frame = _req.args.get('frame')
        want_frame = int(want_frame) if want_frame not in (None, '') else None
    except ValueError:
        want_frame = None
    config = current_app.config['ENCODE_AUTO']

    def _approx():
        # 近似(-ss)フォールバック: key_frames pre-seekでデコード距離を抑える
        raw_kf = recording.get('key_frames')
        key_frames = None
        if raw_kf:
            try:
                key_frames = json.loads(raw_kf) if isinstance(raw_kf, str) else raw_kf
            except Exception:
                key_frames = None
        return get_thumbnail(config.get('ffmpeg', 'ffmpeg'), ts_path,
                             timestamp_sec=t, key_frames=key_frames)

    # 番号表示(efn)・実カット(_trim_avs_line)と同じ time_to_frame でフレームを解決し、
    # そのフレームの絶対PTSにピタリ合わせて取得する。これで 静止画=番号=カット が一致する。
    # フレーム表キャッシュ未生成時は、リクエスト毎の同期全走査(数十秒×並行)で高負荷になるため
    # バックグラウンド生成(単一飛行)に任せて近似で即応答する(完成後の要求から厳密になる)
    try:
        from media.frame_index.cache import get_frame_table_cached
        from media.frame_index.lookup import time_to_frame
        from media.frame_index.table_file import frame_index_path
        data_dir = data_paths.DATA_DIR
        cache_path = frame_index_path(rec_id, data_dir)
        if os.path.exists(cache_path):
            frames, first_pts = get_frame_table_cached(ts_path, cache_path)
            n = want_frame if want_frame is not None else time_to_frame(frames, first_pts, t)
            n = max(0, min(n, len(frames) - 1))
            data = _frame_cached(rec_id, n, lambda: get_frame_by_pts(
                config.get('ffmpeg', 'ffmpeg'), ts_path, frames[n], first_pts))
            # 厳密が取れなかった時に近似へ落ちる道が無く、500 を返して
            # 分割画面が黒くなっていた（実測）。
            if data is None:
                data = _approx()
        else:
            _ensure_frame_build(rec_id, ts_path, cache_path)
            data = _approx()
    except Exception:
        # MPEG-2以外(フレーム表非対応)等は従来の -ss 方式へフォールバック
        data = _approx()
    if data is None:
        abort(500, description='フレーム取得失敗')
    return Response(data, mimetype='image/jpeg')


# 取り出した静止画の使い回し。分割画面は開くたびに話数ぶん（実測で
# 17枚）同じ位置を要求し、しかも同じ位置が二重に飛んでくることがある。
# PTS に飛びのある録画は1枚 1.1〜1.5秒かかる（手前から復号し直すため）ので、
# 作り直すと開くのに 27.5秒かかっていた。録画とエンコードの隣なので効く。
# フレーム番号で引くので、同じ絵を二度作らない。
_FRAME_CACHE = OrderedDict()          # (rec_id, frame) -> jpeg


_FRAME_CACHE_MAX = 200                # 1枚 30KB 程度なので 6MB ほど


_FRAME_CACHE_LOCK = threading.Lock()


_FRAME_MAKING = {}                    # 同じ絵を同時に作らないための錠


def _frame_cached(rec_id, n, make):
    key = (rec_id, n)
    with _FRAME_CACHE_LOCK:
        hit = _FRAME_CACHE.get(key)
        if hit is not None:
            _FRAME_CACHE.move_to_end(key)
            return hit
        lock = _FRAME_MAKING.setdefault(key, threading.Lock())
    # 同じ絵を2本同時に作らない。待っている間に出来ていればそれを使う
    with lock:
        with _FRAME_CACHE_LOCK:
            hit = _FRAME_CACHE.get(key)
        if hit is not None:
            return hit
        data = make()
        with _FRAME_CACHE_LOCK:
            if data is not None:
                _FRAME_CACHE[key] = data
                while len(_FRAME_CACHE) > _FRAME_CACHE_MAX:
                    _FRAME_CACHE.popitem(last=False)
            _FRAME_MAKING.pop(key, None)
        return data
