"""text_parser のパターンと、解析結果を録画の列へ写す補助"""

import asyncio
from quart import (
    current_app,
    request,
    abort,
)
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む


# ---------------------------------------------------------------------------
# パターン管理（text_parser config ラッパー）
# ---------------------------------------------------------------------------


def _tp_to_recording_fields(tp_result: dict) -> dict:
    """text_parser 解析結果を recordings テーブルのフィールド dict に変換する。"""
    import json as _j
    if not tp_result:
        return {}
    def _s(v):
        if v is None: return None
        if isinstance(v, list): return _j.dumps(v, ensure_ascii=False)
        return str(v)
    # parser_error は text_parser_result に残しつつ独立カラムにも保存
    parser_error = tp_result.get('parser_error') or []
    auto_send_v = tp_result.get('auto_send')
    fields = {
        'title':                  _s(tp_result.get('title')),
        'folder':                 _s(tp_result.get('folder')),
        'episode_name':           _s(tp_result.get('episode_name')),
        'episode_number':         _s(tp_result.get('episode_number')),
        'category':               _s(tp_result.get('category')),
        'furigana':               _s(tp_result.get('furigana')),
        'else_info':              _s(tp_result.get('else')),
        'auto_send':              ('true' if auto_send_v else 'false') if auto_send_v is not None else None,
        'app_output_path_format': _s(tp_result.get('app_output_path_format')),
        'is_text_parser':         1,
        'text_parser_result':     _j.dumps(tp_result, ensure_ascii=False),
        'parser_error':           _j.dumps(parser_error, ensure_ascii=False),
    }
    return {k: v for k, v in fields.items() if v is not None}


# parser_error の自動クリア対象フィールド（出力フィールド名）
_PARSER_ERROR_FIELDS = frozenset({
    'title', 'folder', 'episode_name', 'episode_number', 'category',
    'furigana', 'else_info', 'auto_send', 'app_output_path',
    'app_output_path_format', 'setting',
})


def _clear_parser_errors(current_errors: list, filled_fields: dict) -> list:
    """入力済みフィールドに対応する parser_error エントリを除去して返す。
    エラー文字列の ':' 以降がフィールド名。例: 'getFromSid:episode_number'"""
    if not current_errors:
        return current_errors
    filled = {k for k, v in filled_fields.items()
              if k in _PARSER_ERROR_FIELDS and v not in (None, '', '[]')}
    if not filled:
        return current_errors
    return [e for e in current_errors if e.split(':')[-1] not in filled]

def _store():
    return current_app.config['PARSER_STORE']


def _parser(sid: int, create: bool = False):
    """sid に対応する TextParser を返す。
    create=True の場合はファイルが存在しなければ空で新規作成する。
    """
    store = _store()
    p = store.get_or_create_parser(sid) if create else store.get_parser(sid)
    if p is None:
        abort(404, description=f'SID {sid} のパターン設定が見つかりません (SID{sid}-tp.json)')
    return p


async def _push_all_patterns_to_peer(name: str, peer: dict, fed_token: str) -> dict:
    """ローカルの全パターン(全SID)を1ピアへ一括送信する。sync_all_patternsエンドポイントと
    新規ピア検出時の自動シード(_auto_seed_new_peers)の両方から使う共通処理。"""
    import logging
    import requests
    logger = logging.getLogger(__name__)
    store = _store()
    sids = store.list_sids()

    def _send_all(sid, analyzers):
        url = f"{peer['url'].rstrip('/')}/api/patterns/sync?sid={sid}"
        resp = requests.post(url, json={'op': 'bulk_upsert', 'analyzers': analyzers},
                              headers={'X-Fed-Token': fed_token}, timeout=(3, 20),
                              verify=peer.get('verify_tls', True))
        resp.raise_for_status()

    ok_count = 0
    try:
        for sid in sids:
            p = _parser(sid, create=True)
            await asyncio.to_thread(_send_all, sid, p.analyzers)
            ok_count += 1
        return {'ok': True, 'sids': ok_count}
    except Exception as e:
        logger.warning('push_all_patterns: peer=%s failed at sid #%d/%d: %s', name, ok_count, len(sids), e)
        return {'ok': False, 'sids': ok_count, 'error': str(e)}


# ---------------------------------------------------------------------------
# ルール管理（programs DB）
# ---------------------------------------------------------------------------

def _ruledb():
    return current_app.config['RULE_DB']


def _reparse_fn(parser):
    """再解析ボタンの解析。?fresh=1（取り直して再解析）ならしょぼいカレンダーに問い合わせ直す。

    指定が無ければ手元の番組表・作品情報を先に使う（規制中でも、手元で済む解析は通る）。
    """
    if request.args.get('fresh') in ('1', 'true'):
        return parser.parse_text_fresh
    return parser.parse_text


def trim_duration_gap(row: dict) -> float:
    """tag の区間合計と実尺の食い違い（秒）。合っていれば 0。

    区間(trim_segments)は「放送のどこを切り出したか」で、実ファイルの尺と一致するのが正しい。
    食い違う動画は、入力TSが既にCMカット済みだった等で中身が短く、
    コメント/字幕の時刻もその分ずれている（音声比較の相手に選ぶと取り込みが壊れる）。
    """
    import json as _j
    try:
        segs = _j.loads(row.get('trim_segments') or '[]')
        total = sum(float(x.get('duration_sec') or 0) for x in segs)
    except Exception:
        return 0.0
    dur = float(row.get('duration_sec') or 0)
    if total <= 0 or dur <= 0:
        return 0.0
    gap = total - dur
    return round(gap, 1) if abs(gap) / total > 0.02 else 0.0
