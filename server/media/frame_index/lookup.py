"""時刻 → フレーム番号と、先頭の PTS"""

import bisect
from typing import List, Optional
from read_tsprogram.ts_utils import TSPacketUtil
from read_tsprogram.constants import TS_PACKET_SIZE, SYNC_BYTE
from .codec import (  # noqa: F401
    _CLOCK,
    _PTS_CYCLE,
    _video_pid_and_codec,
)
from .pts_diff import _HEAD_PTS_WINDOW, signed_pts_diff  # noqa: F401


def update_first_pts(anchor: Optional[int], first: Optional[int], pts: int):
    """first_pts 候補（先頭PESの最小PTS）を更新して (anchor, first) を返す。

    anchor は最初に見つけたPES PTS（妥当範囲の基準）。異常PTSは無視する。
    encode_pipeline._read_head_refs と read_first_pts で共用する。
    """
    if anchor is None:
        return pts, pts
    if abs(signed_pts_diff(pts, anchor)) > _HEAD_PTS_WINDOW:
        return anchor, first  # 異常値(データ放送のPTS=5等)は除外
    if first is None or signed_pts_diff(pts, first) < 0:
        return anchor, pts
    return anchor, first


def read_first_pts(ts_path: str) -> int:
    """コンテナ先頭の映像PESのうち最小のPTSを返す（プレイヤーの再生時刻t=0に対応）。

    プレビュー/プレイヤーの ffmpeg -ss は映像ストリーム基準でシークするため、
    playhead→フレーム変換(time_to_frame)の原点も映像基準に合わせる。音声が映像より
    先に始まるTSでも音声PTSは採らない（映像PIDのPESのみを対象に min を取る）。
    encode_pipeline._read_head_refs の first_pts と同一定義。
    """
    video_pid, _codec, _apid = _video_pid_and_codec(ts_path)
    if video_pid is None:
        raise RuntimeError(f'映像PIDが検出できません: {ts_path}')
    with open(ts_path, 'rb') as f:
        data = f.read(TS_PACKET_SIZE * 20000)
    anchor = first = None
    for i in range(0, len(data) - TS_PACKET_SIZE + 1, TS_PACKET_SIZE):
        pkt = data[i:i + TS_PACKET_SIZE]
        if pkt[0] != SYNC_BYTE:
            continue
        if TSPacketUtil.get_pid(pkt) == video_pid and TSPacketUtil.has_payload_start(pkt):
            pts = TSPacketUtil.parse_pts(pkt)
            if pts is not None:
                anchor, first = update_first_pts(anchor, first, pts)
    if first is None:
        raise RuntimeError(f'first_pts が取得できません: {ts_path}')
    return first


def time_to_frame(frames: List[int], first_pts: int, t_sec: float) -> int:
    """再生時刻t(秒) を フレーム表のインデックス(Amatsukazeのフレーム番号)へ変換する。

    PTS = first_pts + t*90000（enrich_segments/_trim_avs_line と同一規約）を
    フレーム表(表示順framePTS)で bisect。33bitラップは符号付き差分で吸収する。
    """
    target = first_pts + round(t_sec * _CLOCK)
    d = (target - frames[0]) % _PTS_CYCLE
    if d > _PTS_CYCLE // 2:
        d -= _PTS_CYCLE
    return bisect.bisect_left(frames, frames[0] + d)
_INT32_MIN, _INT32_MAX = -2147483648, 2147483647
