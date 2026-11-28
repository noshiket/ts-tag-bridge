"""取り込みの記録（tag.json と DB）と CM の印"""

import json
import os
from api.routes.tag_io import _save_tag
from ..confirmed.tag import _video_tag_path


def _cm_marks_for_video(video, tag_path, on_log=None):
    """映像判定に使う無音区間の位置を秒で返す。

    1. tag.json の cm_marks（過去に解析したもの）
    2. 無ければ chapter_exe 相当を走らせて求め、tag.json へ残す（実測 40秒。以後0秒）
    3. 解析できなければ chapter_txt で代用する

    chapter_txt はチャプター区間(CM境界)であって無音区間そのものではない。実測で
    チャプター位置は無音区間の部分集合(5/5・6/7が無音区間内)で、数が 1/5 に減るうえ
    位置が偏る(ある動画では [0, 1320, 1335, 1425, 1430] と冒頭と末尾だけで、
    本編中盤に1つも無い)。判定点は本編全体に散っていてほしいので無音区間を基準にする。
    """
    from logic import frame_sync

    tag = {}
    try:
        with open(tag_path, encoding='utf-8') as f:
            tag = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    cached = tag.get('cm_marks')
    if isinstance(cached, list) and cached:
        return [float(x) for x in cached]

    marks = frame_sync.analyze_mute_marks(video['file_path'], on_log=on_log)
    if marks:
        if tag:
            tag['cm_marks'] = marks
            try:
                _save_tag(tag_path, tag)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning('cm_marks の保存に失敗 %s: %s', tag_path, e)
        return marks
    return frame_sync.chapter_marks(video.get('chapter_txt'))


def _append_tag_audio_sync(tag_path, rec):
    """tag.json の audio_sync へ1件足す。"""
    import json as _j
    try:
        with open(tag_path, encoding='utf-8') as f:
            tag = _j.load(f)
        tag.setdefault('audio_sync', []).append(rec)
        _save_tag(tag_path, tag)
        return True
    except Exception as e:
        import logging as _lg
        _lg.getLogger(__name__).warning('audio_sync の記録に失敗 %s: %s', tag_path, e)
        return False


def _record_audio_sync(db, tag_path, video, row, source, ranges, video_check, added,
                       reused=False, method=None, applied=None):
    """取り込んだ時間対応を双方の tag.json に残す（audio_sync）。

    動画内の秒はトリムや再エンコードで変わるので、放送時刻(TOT)でも持つ。
    相手は onid-tsid-sid-eid と eit_start_time で特定できるようにする。
    一致は双方向の情報なので、取り込み元が video なら向こうの tag.json にも
    A と B を入れ替えた同じ対応を書く（相手が録画の場合は tag.json が無いので書かない）。
    DB の列は増やさず tag.json だけに書く（tag.json が正で、add_videos で読み直される）。
    """
    import json as _j

    from logic import frame_sync

    if not ranges:
        return
    try:
        seg_a = _j.loads(video.get('trim_segments') or '[]')
        seg_b = _j.loads(row.get('trim_segments') or '[]')
    except (_j.JSONDecodeError, TypeError):
        seg_a = seg_b = []
    rec = frame_sync.sync_record(
        {'video_id': row.get('id'), 'path': row.get('file_path'),
         'onid': row.get('onid'), 'tsid': row.get('tsid'),
         'sid': row.get('sid'), 'eid': row.get('eid'),
         'eit_start_time': row.get('eit_start_time'),
         'station': row.get('eit_station_name')},
        ranges, video_check, segments_a=seg_a, segments_b=seg_b, method=method)
    rec['added'] = added
    rec['role'] = 'target'
    # 実際に取り込みへ使った区間。ranges(detail)は音声が一致した生の区間で、
    # 取り込みではそこから「ずれが同じなら間も同じ時間軸」として穴を埋めた
    # ものを使う（logic/audio_compare.bridge_ranges）。画面にはこちらを出さないと
    # 「半分しか取り込めていない」ように見える（実測: 生は10区間で
    # 53%しか覆わないが、実際は字幕340件すべて入っている）。
    if applied:
        rec['applied_ranges'] = [
            {'start': round(b0 + off, 3), 'end': round(b1 + off, 3)}
            for b0, b1, off in sorted(tuple(r) for r in applied)]
    if reused:
        rec['reused'] = True      # 前回の解析結果を流用した          # この動画が取り込んだ側
    _append_tag_audio_sync(tag_path, rec)

    # 相手が video なら、向こうにも入れ替えた対応を残す
    if (source or {}).get('kind') != 'video' or not row.get('id'):
        return
    b_tag, b_video = _video_tag_path(db, row['id'])
    if b_video is None or not b_tag or not os.path.exists(b_tag):
        return
    back = frame_sync.sync_record(
        {'video_id': video.get('id'), 'path': video.get('file_path'),
         'onid': video.get('onid'), 'tsid': video.get('tsid'),
         'sid': video.get('sid'), 'eid': video.get('eid'),
         'eit_start_time': video.get('eit_start_time'),
         'station': video.get('eit_station_name')},
        frame_sync.swap_ranges(ranges), video_check,
        segments_a=seg_b, segments_b=seg_a, method=method)
    back['role'] = 'source'
    if reused:
        back['reused'] = True         # この動画は取り込み元として使われた
    back['provided'] = added
    _append_tag_audio_sync(b_tag, back)
