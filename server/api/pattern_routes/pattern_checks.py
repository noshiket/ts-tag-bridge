"""パターンの API の確かめ（局の番号・パターンの形）"""

from quart import request, abort


def _require_sid() -> int:
    sid = request.args.get('sid', type=int)
    if sid is None:
        abort(400, description='sid パラメータが必要です')
    return sid


def _validate_analyzer(body: dict):
    if not isinstance(body.get('pattern'), str) or not body['pattern']:
        abort(400, description='pattern フィールド（非空文字列）が必要です')
    if not isinstance(body.get('analyze'), list) or not body['analyze']:
        abort(400, description='analyze フィールド（非空配列）が必要です')
