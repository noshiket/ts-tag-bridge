"""VideoDB — エンコード完了後の動画管理 DB（categories / albums / series / videos / category_nodes）

tag.json（app_output_path.tag.json）を唯一の入力として録画後の動画運用を管理する。
rules.db やその他の DB は参照しない。

category_nodes は「配下の全 video が C に属する最上位ノード」に category を紐付ける
フロンティア表現を保つ（add_videos の _reconcile_categories 参照）。
"""

import json
import logging


logger = logging.getLogger('db.video_db')   # 分ける前と同じ名前で出す

# tag.json から videos へ同名で取り込む列（file_path / app_output_path_format /
# recording_device / series_id / タイムスタンプは個別に設定するため除く）
_VIDEO_TAG_COLS = (
    'file_size', 'duration_sec', 'onid', 'tsid', 'sid', 'eid', 'furigana', 'is_paid',
    'episode_number', 'episode_name',
    'eit_title', 'eit_description', 'eit_extended_info',
    'eit_start_time', 'eit_end_time', 'eit_station_name', 'eit_genre',
    'eit_video_info', 'eit_audio_info',
    'recording_start_time', 'recording_end_time',
    'trim_segments', 'drop_error', 'text_parser_result', 'setting', 'edcb_tag',
    'comments_json', 'comment_count', 'captions_json', 'captions2_json',
    'captions3_json',
    'chapter_txt', 'thumbnail_path', 'thumbnail_tile_path', 'thumbnail_info',
    'announce', 'encode_dir', 'frame_table',
    # 音楽（logic.music.music_import が登録する）。media_kind は未設定(NULL)なら動画。
    # source_path は変換元の原本(AIFF等)で、再生対象は file_path(再生用MP4)の方。
    'media_kind', 'artist', 'source_path',
    # 曲の同一性キー(logic.music.music_import.music_key)。同じ曲を二重に取り込まないための照合用
    'music_key',
    # 映像コーデック(ffprobe の codec_name)。登録時に入れておくと、HLS 経路に載らない
    # 形式(AV1 等)をカードで示せる。未設定(NULL)なら再生時に判定して埋める
    'video_codec',
)
# dict / list で渡ってきた場合に JSON 文字列化する列
_VIDEO_JSON_COLS = frozenset({
    'trim_segments', 'drop_error', 'text_parser_result',
    'comments_json', 'captions_json', 'captions2_json', 'captions3_json',
    'thumbnail_info', 'frame_table',
})

# tag.json にフォルダ設定が無い動画は series.album_id=NULL となり実アルバム行を持たない。
# これらを仮想アルバム「未分類」として一覧/詳細に表示するための番兵 ID（実 album.id は
# AUTOINCREMENT で 1 以上のため 0 は衝突しない）。クライアントは album.id をそのまま
# 詳細/サムネ URL に使うため、この ID の各取得系は album_id IS NULL 条件へ読み替える。
UNCATEGORIZED_ALBUM_ID = 0


UNCATEGORIZED_ALBUM_NAME = '未分類'


def drop_scramble_counts(raw) -> tuple:
    """drop_error から (ドロップ件数, スクランブル件数) を返す。

    drop は errors 配列があればそこから数える（複数話分割時、errors は話単位に TOT
    トリム済みなので話精度で判定できる）。errors が無い/空の古いデータだけ集計値
    drop_count にフォールバックする（集計値だけ残して errors を落としたデータの救済）。
    集計値 drop_count と errors が食い違う古いデータが多数あり(実測 11943件中1376件)、
    どちらを見るかで「ライブラリの drop 表記」と「録画詳細の重複確認の警告」が
    食い違っていたため、判定と表示の両方をこの1関数に集約する。
    クライアント側 helpers.jsx の dropScrambleCounts と同じ規則。
    """
    if not raw:
        return (0, 0)
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return (0, 0)
    if not isinstance(d, dict):
        return (0, 0)
    errors = d.get('errors')
    if isinstance(errors, list) and errors:
        drop = sum(1 for e in errors if e.get('error_type') == 'PACKET_LOSS')
    else:
        drop = int(d.get('drop_count') or 0)
    return (drop, int(d.get('scramble_count') or 0))


def _has_drop_or_scramble(raw) -> bool:
    """video の drop_error にドロップ(PACKET_LOSS)またはスクランブルがあれば True。"""
    drop, scramble = drop_scramble_counts(raw)
    return drop > 0 or scramble > 0


def _with_issue_fields(d: dict) -> dict:
    """重複表示用の行から drop_error を取り除き、内訳(件数)と has_issue へ畳む。
    重複確認カードでもライブラリと同じ内訳(drop/scr 件数・放送異常告知)を出せるようにする。

    drop_count/scramble_count が列として渡っていればそれを使う（重複索引は全video分を
    作るため、毎回 JSON 解析すると実測で約2秒かかっていた）。列が無い呼び出し元は
    従来どおり drop_error から畳む。"""
    if 'drop_count' in d and d['drop_count'] is not None:
        d.pop('drop_error', None)
        drop = int(d['drop_count'] or 0)
        scramble = int(d.get('scramble_count') or 0)
    else:
        drop, scramble = drop_scramble_counts(d.pop('drop_error', None))
    d['drop_count'] = drop
    d['scramble_count'] = scramble
    d['has_issue'] = drop > 0 or scramble > 0
    return d


def _has_announce(raw) -> bool:
    """しょぼいカレンダーの放送異常告知(announce)が実質的に存在するか。
    クライアントの hasTelop 相当('none...' 始まりは告知なしとみなす)。"""
    return bool(raw) and not str(raw).startswith('none')


def caption_flag(captions_json, captions2_json) -> int:
    """TS由来の字幕(字幕1/字幕2)に実体があるか。1/0。

    captions_json は空でも {"pts_offset":…, "captions": []} という文字列が入るので、
    列の有無ではなく captions 配列の中身で見る（api/routes.py の _has_caption と同じ判定）。

    一覧では JSON 本体を読まずに済むよう has_caption 列へ焼き付ける。実測で
    videos 全13,187本の captions_json を読むだけで 66秒（json_extract まで通すと105秒）
    かかり、アルバム詳細の応答が丸ごとこれに引きずられていた。
    """
    for raw in (captions_json, captions2_json):
        if not raw:
            continue
        try:
            j = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:
            continue
        caps = j.get('captions') if isinstance(j, dict) else j
        if isinstance(caps, list) and caps:
            return 1
    return 0


def comment_track_stats(comments_json, comment_count) -> tuple:
    """(追加トラック数, 一番多いトラックの件数) を返す。

    comments_json は {"comments": [...主トラック], "<名前>": [...取り込んだ実況]} の形。
    一覧はこの2つしか使わないのに、SQL で出すと comments_json 本体を読むことになる
    (実測: 12,770本・合計1.08GB。勢い一覧の20件を出すだけで 3.8〜9秒かかっていた)。
    追加トラックを持つのは 66本だけなので、結果を列に焼き付ける。
    """
    try:
        d = json.loads(comments_json) if isinstance(comments_json, str) else comments_json
    except Exception:
        d = None
    base = int(comment_count or 0)
    if not isinstance(d, dict):
        return 0, base
    added, mx = 0, base
    for k, v in d.items():
        if not isinstance(v, list):
            continue
        if k != 'comments':
            added += 1
        mx = max(mx, len(v))
    return added, mx


