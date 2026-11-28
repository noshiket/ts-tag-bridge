"""動画の解析をやり直す・ファイルから取り込む"""

import asyncio
import os
from quart import jsonify, current_app, abort
from api.routes.auth import bp
from api.routes.caches import _json
from api.routes.tag_io import _load_tag, _save_tag
from api.routes.parser import _reparse_fn, _store
from .confirmed.tag import _reduce_video_tp, _video_tag_path


@bp.post('/videos/<int:video_id>/reparse')
def reparse_video(video_id):
    """eit_title に text_parser を再実行し、tag.json の text_parser_result を更新する（DB 不変更）。"""
    db = current_app.config.get('VIDEO_DB')
    tag_path, v = _video_tag_path(db, video_id)
    if v is None:
        abort(404, description='動画が見つかりません')
    tag = _load_tag(tag_path) if tag_path else None
    if tag is None:
        abort(404, description='tag.json を読めません（無いか壊れています。サーバーログに理由が出ます）')
    # v1.2タグ(旧資産)のeit_titleは波ダッシュ(U+301C 〜)等が未正規化のまま。
    # 通常フローと同じnormalize_textを通さないとパターンのswitch比較(半角~)に
    # 一致せずelseへ落ち、テスト実行と結果が食い違う
    from read_tsprogram.program_info import normalize_text as _tp_norm
    title = _tp_norm(tag.get('eit_title') or '')
    sid = tag.get('sid') or 0
    cfg = current_app.config['ENCODE_AUTO']
    tp_context = {
        **cfg.get('text_parser_context', {}),
        'sid': sid, 'onid': tag.get('onid'), 'tsid': tag.get('tsid'),
        'service_name': tag.get('eit_station_name', '') or '',
        'start_time': tag.get('eit_start_time', '') or '',
        'title': title,
        'description': tag.get('eit_description', '') or '',
        'extended_info': tag.get('eit_extended_info', '') or '',
    }
    tp_parser = _store().get_parser(sid)
    tp_result = _reparse_fn(tp_parser)(title, context=tp_context) if tp_parser else None
    # text_parser_result は複数話のまま tag.json に保存（表示用は idx 縮約して返す）
    tag['text_parser_result'] = tp_result
    _save_tag(tag_path, tag)
    reduced = _reduce_video_tp(tp_result, tag.get('episode_idx'), tag.get('episode_number'))
    return jsonify({'id': video_id, 'text_parser_result': reduced, 'text_parser_context': tp_context,
                    # デバッグ用: パターンテスト画面のSENT REQUEST相当(実際にパーサへ渡した入力)。
                    # 解析はSID全体のパターンファイル(switch含む)を通るため、テスト実行
                    # (単一ブロック)と結果が異なる場合の切り分けに使う
                    'sent_request': {'text': title, 'context': tp_context,
                                     'parser_file': f'SID{sid}-tp.json' if tp_parser else None}})


@bp.post('/videos/import')
async def import_video_from_file():
    """サーバー上にある MP4 を、埋め込みメタデータから取り込む。

    body: { path: '/mnt/.../x.mp4' }
    tag.json が隣にあればそれを使い、無ければ動画に埋めたメタデータから復元する。
    登録後、同じ番組の未紐づけキャプチャは add_video 側で自動的に繋がる。
    """
    from logic.meta import media_meta
    from logic.meta import mp4_meta
    body = await _json()
    path = str(body.get('path') or '')
    if not path or not os.path.isfile(path):
        return jsonify({'error': f'ファイルが見つかりません: {path}'}), 404
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(503, description='video.db が使えません')

    tag = _load_tag(path + '.tag.json')
    source = 'tag.json'
    written = {}
    if not tag:
        cfg = current_app.config['ENCODE_AUTO']
        meta = await asyncio.to_thread(mp4_meta.read_mp4_meta, path,
                                       cfg.get('ffprobe', 'ffprobe'))
        if not meta or meta.get('kind') != 'video' or not meta.get('tag'):
            return jsonify({'error': 'tag.json も埋め込みメタデータもありません'}), 400
        tag = dict(meta['tag'])
        source = '埋め込みメタデータ'
        # 同梱されているサムネ/シークサムネタイルを動画の隣へ書き出す
        # (タイルは動画を全走査しないと作れないので、作り直さずに済ませる)
        stem = os.path.splitext(path)[0]
        written = await asyncio.to_thread(media_meta.extract_images, meta, stem)
        if written.get('thumbnail'):
            tag['thumbnail_path'] = written['thumbnail']
        if written.get('thumbnail_tile'):
            tag['thumbnail_tile_path'] = written['thumbnail_tile']
        if meta.get('thumbnail_info') and not tag.get('thumbnail_info'):
            tag['thumbnail_info'] = meta['thumbnail_info']
    # 置き場所が変わっていることがあるので、実体のパスで上書きする
    tag['app_output_path'] = path
    video_id = await asyncio.to_thread(db.add_videos, tag, True)
    caps = len(db.get_captures(video_id))
    return jsonify({'video_id': video_id, 'source': source, 'captures': caps,
                    'thumbnails': sorted((written or {}).keys()) if source != 'tag.json' else []})
