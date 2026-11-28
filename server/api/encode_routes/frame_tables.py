"""録画のフレーム表（裏で作る・できた分を返す）"""

import data_paths
import os
import threading
from quart import jsonify, abort
from api.routes.auth import bp
from api.routes.parser import _ruledb


_frame_build_status = {}      # rec_id -> 'building' | 'unsupported' | 'error'


_frame_build_lock = threading.Lock()


def _ensure_frame_build(rec_id, ts_path, cache_path):
    """フレーム表キャッシュが無ければバックグラウンドで生成する（多重起動防止）。

    生成には全走査(数十秒)がかかるためリクエストは待たせず、UI 側は近似表示のまま
    ポーリングして完成後に厳密表示へ切り替える。frame_index 未対応(H.264等)は
    'unsupported' を記録し、UI はポーリングを止めて近似のままにする。
    """
    from media.frame_index.cache import get_or_build_frame_table
    with _frame_build_lock:
        if os.path.exists(cache_path):
            return
        if _frame_build_status.get(rec_id) == 'building':
            return
        _frame_build_status[rec_id] = 'building'

    def _run():
        import logging
        try:
            get_or_build_frame_table(ts_path, cache_path, None)
            with _frame_build_lock:
                _frame_build_status.pop(rec_id, None)
            # 生成中に録画が削除された場合はキャッシュを残さない(孤児化防止)
            try:
                from db.rule_db.core import ProgramDB
                db = ProgramDB(os.path.join(data_paths.DATA_DIR, 'rules.db'))
                if db.get_recording(rec_id) is None:
                    from media.frame_index.cache import delete_frame_table
                    delete_frame_table(rec_id, data_paths.DATA_DIR)
                    logging.getLogger(__name__).info(
                        'frame_index build: rec_id=%s は生成中に削除されたためキャッシュを破棄', rec_id)
            except Exception:
                pass
        except RuntimeError as e:
            logging.getLogger(__name__).info('frame_index build unsupported rec_id=%s: %s', rec_id, e)
            with _frame_build_lock:
                _frame_build_status[rec_id] = 'unsupported'
        except Exception as e:
            logging.getLogger(__name__).warning('frame_index build failed rec_id=%s: %s', rec_id, e)
            with _frame_build_lock:
                _frame_build_status[rec_id] = 'error'

    threading.Thread(target=_run, daemon=True, name=f'frameidx-{rec_id}').start()


@bp.get('/encode/recordings/<int:rec_id>/frames')
def frames_recording(rec_id):
    """指定秒(t, カンマ区切り)を Amatsukaze互換の厳密フレーム番号へ変換して返す。

    キャッシュ済みフレーム表を bisect（frame0+レートと違い RFF/ドロップでもずれない）。
    未生成ならバックグラウンド生成を起動し {ready:false,building:true} を返す。
    レスポンス: {ready, frames:[int...], count, building?, unsupported?}
    """
    from quart import request as _req
    from media.frame_index.table_file import frame_index_path
    from media.frame_index.lookup import time_to_frame
    db = _ruledb()
    recording = db.get_recording(rec_id)
    if recording is None:
        abort(404)
    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or ''

    times = []
    for x in (_req.args.get('t', '') or '').split(','):
        x = x.strip()
        if x:
            try:
                times.append(float(x))
            except ValueError:
                pass

    data_dir = data_paths.DATA_DIR
    cache_path = frame_index_path(rec_id, data_dir)
    if os.path.exists(cache_path):
        try:
            # first_pts はキャッシュ作成時の定義の値なので採用せず、現在の定義で取り直す
            # (get_or_build_frame_table と同じ理由。エンコード側の変換と基準を揃える)。
            # インメモリLRUでgzip再読込/ffprobe反復を避ける(プレイヘッド移動毎に呼ばれる)
            from media.frame_index.cache import get_frame_table_cached
            frames, first_pts = get_frame_table_cached(ts_path, cache_path)
            return jsonify({
                'ready': True,
                'count': len(frames),
                'frames': [time_to_frame(frames, first_pts, t) for t in times],
            })
        except Exception:
            pass  # 壊れていれば再生成へ落ちる

    status = _frame_build_status.get(rec_id)
    if status in ('unsupported', 'error'):
        return jsonify({'ready': False, status: True})

    ts_path = recording.get('app_ts_path') or recording.get('host_ts_path') or recording.get('edcb_ts_path', '')
    if not ts_path or not os.path.exists(ts_path):
        abort(404, description='TSファイルが見つかりません')
    _ensure_frame_build(rec_id, ts_path, cache_path)
    return jsonify({'ready': False, 'building': True}), 202
