"""TS の頭の参照（ランダムアクセスできる所・PCR/PTS の対応）"""

from datetime import datetime, timedelta
from read_tsprogram.constants import TS_PACKET_SIZE, SYNC_BYTE, TOT_PID
from read_tsprogram.tot import parse_tot
from read_tsprogram.ts_utils import TSPacketUtil
from read_tsprogram.streams import VIDEO_PID_MIN, VIDEO_PID_MAX

_CLOCK_FREQ = 90_000   # PTS・PCR の時計（90kHz）


def _has_random_access(pkt: bytes) -> bool:
    """adaptation field の random_access_indicator を判定する。"""
    if not (pkt[3] & 0x20):          # adaptation_field なし
        return False
    if pkt[4] < 1:                    # adaptation_field_length == 0
        return False
    return bool(pkt[5] & 0x40)        # random_access_indicator


def _read_head_refs(ts_path: str):
    """TS 先頭から first_pts と TOT 参照点を取得する。

    - first_pts: 先頭付近の全PESのPTS最小値（ffprobe format.start_pts と同一定義。
      プレビュー画像/HLS は ffmpeg の -ss を使うため、再生時刻 t=0 はこの最小PTSに
      なる。物理的に最初のPESが最小とは限らない＝音声が映像より先に始まるTSがある）
    - video_pid: PES stream_id (0xE0-0xEF) + RAI で検出（TOT アンカー用）
    - TOT アンカーは video_pid の last_pts を使う（get_trim_segments と一致させるため）

    BS/CS は TOT が ~10MB 地点に現れるため段階的にチャンクを拡大する。

    Returns:
        (first_pts, tot_ref_or_None)
        tot_ref = (datetime, pts_at_tot)
    """
    from media.frame_index.lookup import update_first_pts

    # 段階的に読む: 940KB → 6MB → 12MB
    steps = [TS_PACKET_SIZE * 5000, TS_PACKET_SIZE * 32000, TS_PACKET_SIZE * 64000]
    first_pts = None       # 先頭チャンクの全PES PTS の最小値 (format.start_pts 相当)
    pts_anchor = None      # first_pts 候補の妥当範囲の基準(最初に見つけたPES PTS)
    video_pid = None       # 映像 PID (stream_id + RAI で検出)
    last_video_pts = None  # video_pid の最新 PTS (TOT アンカー用)
    tot_ref = None

    with open(ts_path, 'rb') as f:
        read_so_far = 0
        for chunk_size in steps:
            in_first_chunk = (read_so_far == 0)  # first_pts の収集は先頭チャンクに限る
            to_read = chunk_size - read_so_far
            if to_read <= 0:
                continue
            data = f.read(to_read)
            if not data:
                break
            for i in range(0, len(data), TS_PACKET_SIZE):
                pkt = data[i:i + TS_PACKET_SIZE]
                if len(pkt) < TS_PACKET_SIZE or pkt[0] != SYNC_BYTE:
                    continue
                pid = TSPacketUtil.get_pid(pkt)
                if VIDEO_PID_MIN <= pid <= VIDEO_PID_MAX and TSPacketUtil.has_payload_start(pkt):
                    pts = TSPacketUtil.parse_pts(pkt)
                    if pts is not None:
                        # first_pts: 先頭の映像PES(stream_id 0xE0-0xEF)のPTS最小値。
                        # プレビュー/プレイヤーの ffmpeg -ss は映像ストリーム基準でシークするため、
                        # playhead→フレーム変換(time_to_frame)の原点も映像基準に合わせる。
                        # 音声は映像より先に始まる場合があるが、その音声PTSは採らない。
                        if in_first_chunk and TSPacketUtil.is_video_pes(pkt):
                            pts_anchor, first_pts = update_first_pts(pts_anchor, first_pts, pts)
                        # video_pid: 映像の I-frame を検出
                        if (video_pid is None
                                and TSPacketUtil.is_video_pes(pkt)
                                and _has_random_access(pkt)):
                            video_pid = pid
                            last_video_pts = pts
                            continue
                        # video_pid 確定後: 映像 PTS を随時更新
                        if video_pid and pid == video_pid:
                            last_video_pts = pts
                if pid == TOT_PID and last_video_pts is not None and tot_ref is None:
                    t = parse_tot(pkt)
                    if t is not None:
                        tot_ref = (t, last_video_pts)
            read_so_far = chunk_size
            if first_pts is not None and tot_ref is not None:
                break

    if first_pts is None:
        raise RuntimeError(f"first_pts not found: {ts_path}")
    return first_pts, tot_ref


def _resolve_maps(ts_path: str, offsets_sec: list[float]):
    """各オフセット(秒)に対応する PTS と TOT を返す。

    PTS は first_pts + T × 90000 の算術計算（PTS はリアルタイムクロック）。
    TOT は先頭 TOT 参照点からの補間。TOT が取れなかった場合は tot_map に含めない。

    Returns:
        (pts_map, tot_map): dict[float, int], dict[float, datetime]
    """
    first_pts, tot_ref = _read_head_refs(ts_path)

    pts_map: dict[float, int] = {}
    tot_map: dict[float, datetime] = {}

    for t in offsets_sec:
        target_pts = first_pts + round(t * _CLOCK_FREQ)
        pts_map[t] = target_pts
        if tot_ref:
            tot_time, tot_pts = tot_ref
            tot_map[t] = tot_time + timedelta(seconds=(target_pts - tot_pts) / _CLOCK_FREQ)

    return pts_map, tot_map
