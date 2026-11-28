"""Amatsukaze のログ（エンコード・チェックの一覧・ファイル・CSV）"""

from quart import jsonify, request
from api.routes.auth import bp
from api.routes.media import _amz
from .amz_call import _amz_call


@bp.get('/amatsukaze/logs/encode/page')
def amz_encode_logs_page():
    """Amatsukaze のエンコードの記録を1ページ分返す。?offset=（0）・limit=（20）。"""
    return jsonify(_amz_call(
        _amz().get_encode_logs_page,
        offset=request.args.get('offset', default=0, type=int),
        limit=request.args.get('limit', default=20, type=int),
    ))


@bp.get('/amatsukaze/logs/check/page')
def amz_check_logs_page():
    """Amatsukaze の確認（チェック）の記録を1ページ分返す。?offset=（0）・limit=（20）。"""
    return jsonify(_amz_call(
        _amz().get_check_logs_page,
        offset=request.args.get('offset', default=0, type=int),
        limit=request.args.get('limit', default=20, type=int),
    ))


@bp.get('/amatsukaze/logs/file')
def amz_log_file():
    """1件のエンコード・確認のログの本文。?encodeStart= か ?checkStart=（その記録の開始時刻）で指定する。"""
    return jsonify(_amz_call(
        _amz().get_log_file,
        encode_start=request.args.get('encodeStart'),
        check_start=request.args.get('checkStart'),
    ))


@bp.get('/amatsukaze/logs/encode.csv')
def amz_encode_csv():
    """Amatsukaze のエンコードの記録を CSV で返す。"""
    from quart import Response
    data = _amz_call(_amz().get_encode_csv)
    return Response(data, content_type='text/csv; charset=utf-8')


@bp.get('/amatsukaze/logs/check.csv')
def amz_check_csv():
    """Amatsukaze の確認（チェック）の記録を CSV で返す。"""
    from quart import Response
    data = _amz_call(_amz().get_check_csv)
    return Response(data, content_type='text/csv; charset=utf-8')
