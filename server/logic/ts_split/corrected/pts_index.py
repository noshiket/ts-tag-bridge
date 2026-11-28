"""映像の PTS の並びと最初の PTS を TS から読む"""

from typing import List, Optional, Tuple
from read_tsprogram.constants import PAT_PID, SYNC_BYTE, TS_PACKET_SIZE
from read_tsprogram.pcr_scan import PID_NULL
from read_tsprogram.streams import PTS_CYCLE
from read_tsprogram.ts_utils import TSPacketUtil
from .pts import _extract_pes_pts


def _build_video_pts_index(ts_path: str, video_pid: int) -> List[Tuple[int, int, bool]]:
    """
    ビデオ PES 先頭パケット (PUSI=1) をスキャンし、
    [(pts_90kHz, file_byte_offset, random_access_indicator), ...] を返す。

    PTS は 33bit (PTS_CYCLE) でラップアラウンドするため、ファイル順に走査しながら
    連続値へアンラップして返す。これにより後続の PTS ソート / bisect が
    ラップを跨ぐファイルでも正しいフレーム順・byte offset 対応を保つ。
    """
    result: List[Tuple[int, int, bool]] = []
    buf_start = 0
    remainder = b''

    # --- PTS アンラップ用 ---
    # B フレームによる局所的な逆順 (~1秒未満) を誤検出しないよう、
    # 半周期 (PTS_CYCLE/2) を超える後退のみラップと判定する。
    PTS_HALF = PTS_CYCLE // 2
    prev_raw_pts: Optional[int] = None
    pts_wrap_offset = 0

    with open(ts_path, 'rb') as f:
        while True:
            chunk = f.read(TS_PACKET_SIZE * 4096)
            if not chunk:
                break
            data = remainder + chunk
            pos = 0
            while pos < len(data) and data[pos] != SYNC_BYTE:
                pos += 1
            while pos + TS_PACKET_SIZE <= len(data):
                if data[pos] != SYNC_BYTE:
                    nxt = data.find(SYNC_BYTE, pos + 1)
                    if nxt < 0:
                        pos = len(data)
                        break
                    pos = nxt
                    continue
                raw = data[pos:pos + TS_PACKET_SIZE]
                pid = ((raw[1] & 0x1F) << 8) | raw[2]
                if pid == video_pid and (raw[1] & 0x40):   # PUSI=1
                    pts = _extract_pes_pts(raw)
                    if pts is not None:
                        if prev_raw_pts is not None and pts - prev_raw_pts < -PTS_HALF:
                            pts_wrap_offset += PTS_CYCLE
                        prev_raw_pts = pts
                        afc = (raw[3] >> 4) & 0x3
                        rai = False
                        if afc in (0b10, 0b11) and raw[4] >= 1:
                            rai = bool(raw[5] & 0x40)
                        result.append((pts + pts_wrap_offset, buf_start + pos, rai))
                pos += TS_PACKET_SIZE
            remainder = data[pos:]
            buf_start += pos
    return result


def _get_initial_pts_min(ts_path: str, ref_pts: Optional[int] = None,
                          scan_limit: int = 50_000) -> Optional[int]:
    """
    全エレメンタリーストリームの最初のPTSの最小値を返す。
    ffmpeg の format.start_time 相当（音声・映像の中で最も早いPTS）。

    Args:
        ref_pts:  参照PTS（映像の初期PTSなど）。指定すると ref_pts から
                  60秒以上離れた異常なPTSを除外する（字幕の不正値対策）。
    """
    min_pts: Optional[int] = None
    seen_pids: set = set()
    MAX_DIFF = 60 * 90_000  # 60秒以上乖離するPTSは除外

    with open(ts_path, 'rb') as f:
        remainder = b''
        count = 0
        while count < scan_limit:
            chunk = f.read(TS_PACKET_SIZE * 1024)
            if not chunk:
                break
            data = remainder + chunk
            pos = 0
            while pos < len(data) and data[pos] != SYNC_BYTE:
                pos += 1
            while pos + TS_PACKET_SIZE <= len(data) and count < scan_limit:
                if data[pos] != SYNC_BYTE:
                    next_sync = data.find(SYNC_BYTE, pos + 1)
                    if next_sync < 0:
                        pos = len(data)
                        break
                    pos = next_sync
                    continue
                packet = data[pos:pos + TS_PACKET_SIZE]
                pos += TS_PACKET_SIZE
                count += 1
                pid = TSPacketUtil.get_pid(packet)
                if pid in (PAT_PID, PID_NULL):
                    continue
                if (packet[1] & 0x40) and pid not in seen_pids:  # PUSI=1 かつ初回
                    pts = _extract_pes_pts(packet)
                    if pts is not None:
                        if ref_pts is not None and abs(pts - ref_pts) > MAX_DIFF:
                            continue  # 異常なPTS（字幕不正値等）を除外
                        seen_pids.add(pid)
                        if min_pts is None or pts < min_pts:
                            min_pts = pts
            remainder = data[pos:]

    return min_pts
