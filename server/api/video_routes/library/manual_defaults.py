"""動画追加の既定値（置き場所の候補・パス形式）"""

import os
from quart import jsonify, current_app
from api.routes.auth import bp


_MANUAL_TAG_STR_FIELDS = (
    'folder', 'title', 'episode_number', 'episode_name', 'furigana',
    'eit_title', 'eit_station_name', 'eit_start_time', 'eit_end_time',
    'eit_description', 'eit_extended_info', 'eit_genre',
    'eit_video_info', 'eit_audio_info',
    'recording_start_time', 'recording_end_time',
    'setting', 'edcb_tag', 'announce', 'encode_dir',
    # パス形式。省略時は config.yml の output_path が入る(_manual_output_format)
    'app_output_path_format',
)


def _upload_roots(config):
    """アップロードの保存先として許可するルート。encode_dir_list をそのまま使う。"""
    return [os.path.realpath(d) for d in (config.get('encode_dir_list') or []) if d]


@bp.get('/videos/add_manual_defaults')
def video_add_manual_defaults():
    """「動画追加」フォームの既定値と入力候補。

    app_output_path_format は config.yml の output_path＝エンコード時と同じテンプレート。
    stations はライブラリで既に使われている放送局（名前と識別子）。同じ局を別名で登録すると
    SID が新しく採番されて別の局として扱われてしまうため、入力時の候補に出す。
    """
    db = current_app.config.get('VIDEO_DB')
    stations = []
    if db is not None:
        rows = db._get_conn().execute("""
            SELECT eit_station_name AS name, onid, tsid, sid, MAX(id) AS last_id
            FROM videos
            WHERE eit_station_name IS NOT NULL AND eit_station_name != ''
            GROUP BY eit_station_name ORDER BY eit_station_name
        """).fetchall()
        stations = [{'name': r['name'], 'onid': r['onid'], 'tsid': r['tsid'], 'sid': r['sid']}
                    for r in rows]
    return jsonify({'app_output_path_format':
                    _manual_output_format(current_app.config['ENCODE_AUTO'], {}),
                    'stations': stations})


def _manual_output_format(config: dict, tag: dict) -> str:
    """手入力追加のファイル名・パスを決めるテンプレート。

    config.yml の output_path（エンコード時と同じ既定のテンプレート）を使う。
    tag に app_output_path_format があればそちらを優先する。
    """
    return (tag.get('app_output_path_format')
            or config.get('output_path')
            or '{$encode_dir}/{$folder}/[{$service_name}]{$title}_#{$episode_number}'
               '_{$setting}{$start_time}{$ext}')
