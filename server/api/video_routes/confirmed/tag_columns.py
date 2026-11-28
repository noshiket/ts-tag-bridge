"""tag.json を DB の列へ写す（コーデックを補う）"""

from typing import Optional
from quart import current_app
from api.routes.media import _TS_STREAMABLE_VIDEO_CODECS


def _fill_video_codec(tag: dict, file_path: str) -> Optional[str]:
    """登録する動画の映像コーデックを調べて tag に入れ、警告が要るなら文言を返す。

    AV1/VP9 など psisimux → エンコーダの経路(HLS)に載らない形式でも登録は通す。
    その場合はブラウザが直接再生する（KonomiTV は登録自体を拒否するが、ここでは
    観られなくなる方が困るので警告だけ出す）。
    """
    from media.probe.ffprobe import get_video_info

    if tag.get('video_codec'):
        codec = tag['video_codec']
    else:
        info = get_video_info(current_app.config['ENCODE_AUTO'].get('ffprobe', 'ffprobe'),
                              file_path) or {}
        codec = (info.get('video') or {}).get('codec') or ''
        if codec:
            tag['video_codec'] = codec
    if codec and codec not in _TS_STREAMABLE_VIDEO_CODECS:
        return (f'映像コーデックが {codec} です。サーバー側の変換(画質切替・字幕合成)は使えず、'
                f'ブラウザが直接再生できる場合のみ再生できます')
    return None


def _apply_tag_to_video_columns(db, video_id: int, tag: dict) -> list:
    """tag.json の値のうち videos の列に対応するものを DB へ反映して、列名を返す。

    tag.json は確定値の保存先で、DB へは通常 relocate 時の再登録で入る。eit_start_time の
    ように普段は編集できない値をここで直したときに、その場で一覧・プレイヤーへ出るように
    列を直接更新する。add_videos(replace=True) の削除+再登録は取り込んだ字幕・実況や
    ローカル保存の紐づけを失うので使わない。

    列に無いもの（folder/title＝アルバム・シリーズ等）は対象外。category だけは別テーブル
    なので専用の更新を呼ぶ。
    """
    import json as _j

    cols = {r[1] for r in db._get_conn().execute('PRAGMA table_info(videos)')}
    # id/紐づけと、他の列から導かれる列は触らない（update_video が追従させる）
    skip = {'id', 'series_id', 'created_at', 'updated_at', 'sort_order',
            'has_caption', 'drop_count', 'scramble_count',
            'added_comment_tracks', 'max_comment_count'}
    fields = {}
    for key, value in tag.items():
        col = 'file_path' if key == 'app_output_path' else key
        if col not in cols or col in skip:
            continue
        if isinstance(value, (dict, list)):
            value = _j.dumps(value, ensure_ascii=False)
        fields[col] = value
    if fields:
        db.update_video(video_id, **fields)
    cats = tag.get('category')
    if isinstance(cats, str):
        cats = [c.strip() for c in cats.split(',') if c.strip()]
    if isinstance(cats, list):
        db.update_video_categories(video_id, cats)
        fields['category'] = cats
    return sorted(fields)
