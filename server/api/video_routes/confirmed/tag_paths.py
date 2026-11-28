"""動画・音楽を置く場所（既定の音楽の置き場・手で足す動画の行き先）"""

import os
from ..library.manual_defaults import _manual_output_format, _upload_roots


def music_default_dir(config) -> str:
    """音楽の既定の保存先。動画と同じく encode_dir_list の先頭。"""
    roots = _upload_roots(config)
    return roots[0] if roots else ''


def _manual_dest_path(config: dict, tag: dict, file_path: str, encode_dir: str) -> tuple:
    """テンプレートを展開して置き場所を決める。戻り値 (パス, 使ったテンプレート)。

    展開は text_parser の setPath と同じ関数(_resolve_set_path)を使う。'!'→'！' 等の
    変換も start_time の YYYYMMDD-HHmm 化も、エンコード時と同じ規則になる。
    """
    from text_parser.parser.core import TextParser

    template = _manual_output_format(config, tag)
    fields = {
        'encode_dir': encode_dir.rstrip('/'),
        'folder': tag.get('folder') or '',
        'title': tag.get('title') or tag.get('eit_title') or '',
        'episode_number': tag.get('episode_number') or '',
        'episode_name': tag.get('episode_name') or '',
        'service_name': tag.get('eit_station_name') or '',
        'start_time': tag.get('eit_start_time') or tag.get('recording_start_time') or '',
        'setting': tag.get('setting') or '',
        # 拡張子は元ファイルから。config の text_parser_context.ext は既定値として使う
        'ext': os.path.splitext(file_path)[1] or (config.get('text_parser_context') or {}).get('ext', ''),
    }
    path = TextParser._resolve_set_path(None, template, fields)
    if isinstance(path, list):
        path = path[0] if path else ''
    return path, template
