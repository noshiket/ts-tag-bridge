"""tag.json の読み書きと、音声比較の候補"""

import os
from quart import (
    jsonify,
    current_app,
    abort,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from api.routes.tag_io import _load_tag, _save_tag  # noqa: F401
from .tag_columns import _apply_tag_to_video_columns


# ---------------------------------------------------------------------------
# ライブラリ動画（video.db）の確定値編集 — 確定値タブ vdb 対応
# 編集は tag.json（app_output_path.tag.json）に書き、DB は変更しない。
# DB は relocate の add_videos（新 tag.json 取り込み）でのみ更新する設計。
# ---------------------------------------------------------------------------

# 話数ごとにリスト化される text_parser 出力フィールド（TextParser._COMBINE_FIELDS と対応）。
# これ以外のリスト値（category=カテゴリ名の配列 等）は全話共通の値なので episode_idx で
# 仕分けてはならない。
_PER_EPISODE_TP_FIELDS = ('episode_name', 'episode_number')


def _reduce_video_tp(tp_result, episode_idx=None, cur_episode_number=None):
    """複数話の text_parser 結果（リスト値）を、この video の単話へ縮約する。
    episode_idx があればそれで縮約。無ければ cur_episode_number 一致で idx を特定（既存救済）。
    縮約対象は話数ごとに増える _PER_EPISODE_TP_FIELDS のみ。"""
    if not isinstance(tp_result, dict):
        return tp_result
    ep = tp_result.get('episode_number')
    if not isinstance(ep, list):
        return tp_result
    idx = episode_idx
    if not isinstance(idx, int) or idx < 0:
        cur_s = '' if cur_episode_number is None else str(cur_episode_number)
        idx = next((i for i, x in enumerate(ep) if str(x) == cur_s), 0)
    return {k: (val[idx] if (k in _PER_EPISODE_TP_FIELDS and isinstance(val, list)
                             and idx < len(val)) else val)
            for k, val in tp_result.items()}


def _video_tag_path(db, video_id):
    """video の tag.json パス（file_path + '.tag.json'）と video 行を返す。"""
    v = db.get_video_row(video_id) if db else None
    if v is None or not v.get('file_path'):
        return None, v
    return v['file_path'] + '.tag.json', v


def _video_confirmed_dict_from_tag(video_id, tag):
    """tag.json を ConfirmedFieldEditor/ParsePreview が食える augmented-recording 形にする。
    確定値は tag の直接フィールド（既に単話）、parseResult は text_parser_result を idx 縮約。"""
    import json as _j
    tpr_full = tag.get('text_parser_result') or {}
    if isinstance(tpr_full, str):
        try: tpr_full = _j.loads(tpr_full)
        except Exception: tpr_full = {}
    # 複数話判定: text_parser_result の episode_number がリストなら話数分ある
    ep_list = tpr_full.get('episode_number') if isinstance(tpr_full, dict) else None
    episode_count = len(ep_list) if isinstance(ep_list, list) else 1
    idx = tag.get('episode_idx')
    if not isinstance(idx, int) or idx < 0:
        idx = 0
    tpr = _reduce_video_tp(tpr_full, idx, tag.get('episode_number'))
    # 確定値は tag 生成時に単話へ縮約済みだが、万一 list が残っていても episode_idx で
    # 単話化する（防御的）。category は「カテゴリ名の配列」なので縮約しない。
    def _red(key, val):
        if key != 'category' and isinstance(val, list):
            return val[idx] if idx < len(val) else (val[0] if val else None)
        return val
    confirmed = {
        'title': _red('title', tag.get('title')),
        'folder': _red('folder', tag.get('folder')),
        'episode_number': _red('episode_number', tag.get('episode_number')),
        'episode_name': _red('episode_name', tag.get('episode_name')),
        'category': tag.get('category'),
        'furigana': _red('furigana', tag.get('furigana')),
        'else_info': _red('else_info', tag.get('else_info')),
        'app_output_path_format': _red('app_output_path_format', tag.get('app_output_path_format')),
        'app_output_path': _red('app_output_path', tag.get('app_output_path')),
        'setting': _red('setting', tag.get('setting')),
        # 音楽の曲情報として編集する（動画では画面に出していない）
        'eit_genre': tag.get('eit_genre'),
        'eit_start_time': tag.get('eit_start_time'),
        'eit_description': tag.get('eit_description'),
        'encode_dir': tag.get('encode_dir'),
    }
    return {
        'id': video_id, 'dbVideoId': video_id, 'isVideo': True,
        # 音楽は同じ確定値でも意味が違う(folder=アーティスト / title=アルバム /
        # episode_name=曲名 / episode_number=トラック番号)ので、画面の見出しを変える
        'media_kind': tag.get('media_kind') or 'video',
        # 音楽の曲情報（埋め込みタグそのもの）。歌詞や作曲者もここに入る
        'media_tags': tag.get('media_tags') or {},
        'sid': tag.get('sid'), 'title': tag.get('eit_title') or '',
        # ParsePreview は r の各フィールドから解析コンテキストを組んで再解析する。
        # reparse(/videos/<id>/reparse) と同じ入力になるよう EIT 由来の値を揃えて返す。
        'onid': tag.get('onid'), 'tsid': tag.get('tsid'),
        'service_name': tag.get('eit_station_name') or '',
        'start_time': tag.get('eit_start_time') or '',
        'description': tag.get('eit_description') or '',
        'extended_info': tag.get('eit_extended_info') or '',
        'confirmed': confirmed, 'parseResult': tpr, 'parser_error': [],
        # 複数話(count>1)の video で episode_idx を編集できるように、現在idxと
        # 未縮約の全話parseResult(idx切替時のフィールド再導出に使う)を返す
        'episode_idx': idx, 'episode_count': episode_count, 'parseResultFull': tpr_full,
        'isTextParser': 1,
    }


@bp.get('/videos/<int:video_id>/tag')
def get_video_tag(video_id):
    """動画の tag.json の中身を返す（カードの「…」から中身を見る用）。

    tag.json は動画ファイル+".tag.json" の位置にある。無い場合も 200 で
    exists=false を返し、クライアント側で「まだ無い」ことを出せるようにする。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    file_path = video.get('file_path') or ''
    if not file_path:
        abort(404, description='この動画にはファイルパスがありません')
    tag_path = file_path + '.tag.json'
    tag = _load_tag(tag_path)
    return jsonify({'tag_path': tag_path, 'exists': tag is not None, 'tag': tag or {}})


@bp.put('/videos/<int:video_id>/tag')
async def put_video_tag(video_id):
    """編集した tag.json を書き戻す。body: {tag: {...}, apply: bool}

    apply=true なら同じ内容でライブラリ(video.db)へ再登録して表示にも反映する
    （tag.json を書くだけでは一覧・確定値は変わらないため）。反映する場合は
    app_output_path の実ファイルが必要。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    file_path = video.get('file_path') or ''
    if not file_path:
        abort(404, description='この動画にはファイルパスがありません')
    body = await _json()
    tag = body.get('tag')
    if not isinstance(tag, dict):
        abort(400, description='tag はオブジェクトで指定してください')
    tag_path = file_path + '.tag.json'
    _save_tag(tag_path, tag)

    updated = []
    if body.get('apply'):
        aop = tag.get('app_output_path')
        if aop and not os.path.isfile(aop):
            abort(400, description=f'app_output_path のファイルが見つかりません: {aop}')
        updated = _apply_tag_to_video_columns(db, video_id, tag)
    return jsonify({'tag_path': tag_path, 'applied': bool(body.get('apply')),
                    'updated': updated, 'id': video_id})


