"""予約一覧（確定値・解析結果・重複を添えた形）・チューナー・局ロゴ"""

from datetime import datetime
from quart import jsonify, abort
from api import schemas
from api.routes.auth import bp, perm, require_screen
from api.routes.rec_aug_dups import _build_video_dup_map, _dup_for_recording
from api.routes.parser import _ruledb
from api.routes.rec_aug_rows import _shoboi_info, _state_to_action
from .epg import _enum_reserve_cached


# 予約詳細でしか使わない重いフィールド。433件で合計670KB(全体の70%)あり、一覧では
# 表示にも絞り込みにも使わないので落とす。詳細は /reserves/augmented/<reserveID> で全部返す。
_RESERVE_DETAIL_ONLY = ('rec_setting', 'text_parser_result', 'extended_info', 'duplicate_info',
                        'shoboi_info')


def _build_reserve_aug_result() -> list:
    """EDCB予約一覧 + rule_db の tags / action を結合したリストを返す。

    予約詳細の表示用に、確定値で照合した既存videoとの重複(duplicate_info)も付与する。"""
    items = _enum_reserve_cached()
    db = _ruledb()
    dup_map = _build_video_dup_map()
    result = []
    for r in items:
        base = schemas.reserve_to_response(r)
        program = db.get_by_reserve_id(r['reserveID'])
        base['tags'] = []
        base['action'] = 'encode'
        base['rule_state'] = None
        base['rule_id'] = None
        base['auto_add_id'] = None
        base['text_parser_result'] = {}
        base['parser_error'] = []
        base['description'] = ''
        base['extended_info'] = ''
        base['genre'] = ''
        base['video_info'] = ''
        base['audio_info'] = ''
        base['confirmed'] = {}
        base['duplicate_info'] = []
        base['auto_skip_reason'] = None
        base['shoboi_info'] = None
        if program:
            base['shoboi_info'] = _shoboi_info(program.get('shoboi_info'))
            tpr = program.get('text_parser_result') or {}
            if isinstance(tpr, str):
                import json as _j
                try:
                    tpr = _j.loads(tpr)
                except Exception:
                    tpr = {}
            base['tags'] = tpr.get('tags', [])
            state = program.get('state', '')
            base['rule_state'] = state
            base['rule_id'] = program['id']
            base['auto_add_id'] = program.get('auto_add_id')
            base['text_parser_result'] = tpr
            base['parser_error'] = program.get('parser_error') or []
            base['action'] = _state_to_action(state)
            # このアプリが自動で無効にした理由。録画有効に戻されていれば出さない
            # （EDCB側/手動のスキップと区別して一覧で絞り込むために使う）
            base['auto_skip_reason'] = (program.get('auto_skip_reason')
                                        if not base.get('rec_enabled') else None)
            base['description'] = program.get('original_description') or ''
            base['extended_info'] = program.get('original_extended_info') or ''
            base['genre'] = program.get('genre') or ''
            base['video_info'] = program.get('video_info') or ''
            base['audio_info'] = program.get('audio_info') or ''
            base['confirmed'] = {f: program.get(f) for f in (
                'title', 'folder', 'episode_name', 'episode_number',
                'category', 'furigana', 'else_info', 'auto_send',
                'is_text_parser', 'app_output_path', 'app_output_path_format',
                'encode_dir', 'setting',
            )}
            # 既存videoとの重複(録画詳細と同じ確定値照合。programの生値は録画と同形式)
            if dup_map:
                try:
                    base['duplicate_info'] = _dup_for_recording(dup_map, program)
                except Exception:
                    pass
        result.append(base)

    # EDCB に無い予約（アドオンが programs へ直接入れた配信の予約など）も出す。
    # 上のループは EDCB を起点にしているので、これが無いと DB 上の予約が見えない。
    # reserve_id は EDCB のものと衝突しないよう programs.id の符号を反転して使う
    # （EDCB 向けの削除/スキップAPIには渡らない。画面側は source で見分ける）。
    for program in db.list_rules_without_reserve():
        tpr = program.get('text_parser_result') or {}
        state = program.get('state', '')
        # 済んだものは予約ではないので出さない。EDCB の予約は録り終えると
        # EDCB 側から消えて予約一覧から居なくなるが、アドオンが入れた予約は
        # DB に残り続けるため、ここで揃える（録画結果の方に出る）。
        # error は原因が分かるよう残す
        if state in ('recorded', 'encoded', 'done', 'cancelled'):
            continue
        result.append({
            'reserve_id': -program['id'], 'source': 'addon',
            'title': program.get('original_title') or '',
            'station_name': program.get('station_name') or '',
            # sid だけは持つことがある。配信の予約は EDCB のサービスを持たないが、
            # text_parser のパターンは SID{n}-tp.json で引くため、これが無いと
            # 予約の画面からパターンを登録できない（context.sid が必要です と出る）
            'onid': None, 'tsid': None, 'sid': program.get('sid'), 'event_id': None,
            # 番組表の予約済み表示は、これと開始時刻で引く。局名で引くと
            # 配信側が局名を変えたとたんに印が消えるため、変わらないIDを渡す
            'ch': program.get('ch'),
            'start_time': program.get('start_time'),
            'duration_sec': _duration_sec(program.get('start_time'),
                                          program.get('expected_end_time')),
            'comment': '', 'overlap_mode': 0, 'rec_enabled': 1,
            'rec_setting': {}, 'size': '',
            'tags': tpr.get('tags', []) if isinstance(tpr, dict) else [],
            'action': _state_to_action(state),
            'rule_state': state, 'rule_id': program['id'],
            'auto_add_id': None,
            'text_parser_result': tpr if isinstance(tpr, dict) else {},
            'parser_error': program.get('parser_error') or [],
            'description': program.get('original_description') or '',
            'extended_info': program.get('original_extended_info') or '',
            'genre': program.get('genre') or '',
            'video_info': '', 'audio_info': '',
            # 確定値。EDCB の予約と同じく programs から組み立てる。
            # 空の決め打ちにしていたため、保存はできているのに詳細画面で
            # 反映されていないように見えていた
            'confirmed': {f: program.get(f) for f in (
                'title', 'folder', 'episode_name', 'episode_number',
                'category', 'furigana', 'else_info', 'auto_send',
                'is_text_parser', 'app_output_path', 'app_output_path_format',
                'encode_dir', 'setting',
            )},
            'duplicate_info': [], 'auto_skip_reason': None,
            'shoboi_info': _shoboi_info(program.get('shoboi_info')),
        })
    return result


def _duration_sec(start: str, end: str) -> int:
    """'YYYY-MM-DD HH:MM:SS'(または ISO) 2つから秒数。読めなければ 0。"""
    def _p(v):
        try:
            return datetime.fromisoformat(str(v)[:19].replace(' ', 'T'))
        except (ValueError, TypeError):
            return None
    s, e = _p(start), _p(end)
    return int((e - s).total_seconds()) if s and e and e > s else 0


@bp.get('/reserves/augmented')
def list_reserves_augmented():
    """予約一覧。詳細でしか使わない重いフィールドは落とす（30秒ごとに取り直すため）。"""
    require_screen('reservations')
    result = perm().filter_items(_build_reserve_aug_result())
    # 一覧カードは「登録済」バッジを出すだけなので件数だけ渡す(一致videoの中身は詳細で取る。
    # 中身まで載せると gzip 後で +11KB/442件になる)
    return jsonify([{**{k: v for k, v in r.items() if k not in _RESERVE_DETAIL_ONLY},
                     'duplicate_count': len(r.get('duplicate_info') or [])}
                    for r in result])


# reserve_id はアドオンの予約だと負（programs.id の符号反転）。既定の int 変換器は
# 負数を受けないためルートに当たらず 404 になっていた。signed=True で受ける
@bp.get('/reserves/augmented/<int(signed=True):reserve_id>')
def get_reserve_augmented(reserve_id):
    """予約1件を全フィールド返す（予約詳細用。一覧は軽量版のため）。"""
    require_screen('reservations')
    for r in perm().filter_items(_build_reserve_aug_result()):
        if r.get('reserve_id') == reserve_id:
            return jsonify(r)
    abort(404, description='予約が見つかりません')


