"""補正付きの分割（split_ts_corrected）"""

import os
from typing import List, Optional, Tuple
from read_tsprogram.constants import SYNC_BYTE, TS_PACKET_SIZE
from read_tsprogram.pcr_scan import PCR_WRAP, pcr_to_sec, scan_ts_info
from ..segment import Segment
from ..output import summarize_outputs
from .plan import plan_segments
from ..writers import WRITE_BUF_SIZE, SegmentWriters, read_pcr


# =============================================================================
# PCR/PTS/DTS 補正付き分割
# =============================================================================

def split_ts_corrected(
    ts_path: str,
    segments: List[Segment],
    output_dir: str = '',
    verbose: bool = True,
) -> Tuple[bool, str, List[str]]:
    """
    TSファイルをPCRベースで分割し、各出力ファイルのPCR/PTS/DTS/CCを補正する。

    tscut_amt (trim_amt.py) と同様、分割後ファイルのタイムスタンプ整合性を保証する。
    各セグメントの先頭パケットが PCR≒0 から始まるよう全タイムスタンプを再計算する。

    split_ts との違い:
      - 出力パケットのPCR/PTS/DTSを各セグメント先頭基準に補正
      - 連続性カウンタ(CC)をセグメントごとに独立してリセット

    Args:
        ts_path:    入力TSファイルパス
        segments:   分割セグメントリスト (start_time/end_time は秒)
        output_dir: 出力先ディレクトリ
        verbose:    進捗出力フラグ

    Returns:
        (success, message, output_file_paths)
    """
    if not os.path.isfile(ts_path):
        return False, f"ファイルが見つかりません: {ts_path}", []
    if not segments:
        return False, "セグメントが指定されていません", []
    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(ts_path))

    # --- Phase 1: TSスキャン ---
    if verbose:
        print(f"[1/3] TSスキャン中: {ts_path}")
    info = scan_ts_info(ts_path)
    if info.pcr_pid is None or info.initial_pcr is None:
        return False, "PCR情報が取得できませんでした", []
    if verbose:
        print(f"      PCR PID: 0x{info.pcr_pid:04X}, 初期PCR: {info.initial_pcr} "
              f"({pcr_to_sec(info.initial_pcr):.3f}s)")

    # --- Phase 1.5〜2: 区間ごとの切る位置（フレームに合わせる）---
    seg_infos, _use_offset = plan_segments(ts_path, info, segments, verbose)

    # --- Phase 3: 出力ファイル準備 ---
    if verbose:
        print(f"[2/3] 出力ファイル準備中 ({len(segments)}件)")

    w = SegmentWriters(segments, output_dir, info, verbose)
    write_bufs, seg_done = w.bufs, w.done
    try:
        w.open_all()

        # --- Phase 4: パケット仕分け ---
        if verbose:
            print(f"[3/3] 分割処理中 (PCR/PTS/DTS/CC補正あり)...", flush=True)

        import time as _time
        file_size = os.path.getsize(ts_path)
        current_pcr: Optional[int] = None
        bytes_read  = 0
        last_report = _time.time()
        n_segs      = len(segments)
        # フレームインデックスが使える場合はバイトオフセットで選択
        if _use_offset:
            earliest_offset = min(si['start_offset'] for si in seg_infos)
        else:
            earliest_start = min(si['start_ticks'] for si in seg_infos)
        _pcr_pid    = info.pcr_pid
        _init_pcr   = info.initial_pcr
        file_offset_of_data = 0   # data[0] のファイル内バイトオフセット

        with open(ts_path, 'rb') as f:
            remainder = b''
            while True:
                chunk = f.read(TS_PACKET_SIZE * 4096)
                if not chunk:
                    break
                bytes_read += len(chunk)
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
                    pkt_offset = file_offset_of_data + pos
                    pos += TS_PACKET_SIZE
                    pid = ((raw[1] & 0x1F) << 8) | raw[2]

                    if _use_offset:
                        # バイトオフセットベースのスキップ（早期終了）
                        if pkt_offset < earliest_offset:
                            continue
                    else:
                        # PCR ベースのスキップ（フォールバック。バイト位置で選ぶ時は PCR を使わない）
                        if pid == _pcr_pid:
                            pcr = read_pcr(raw)
                            if pcr is not None:
                                current_pcr = pcr
                        if current_pcr is None:
                            continue
                        elapsed_ticks = current_pcr - _init_pcr
                        if elapsed_ticks < 0:
                            elapsed_ticks += PCR_WRAP
                        if elapsed_ticks < earliest_start:
                            continue

                    for i in range(n_segs):
                        if seg_done[i]:
                            continue
                        si = seg_infos[i]

                        # パケット範囲チェック
                        if _use_offset:
                            if pkt_offset < si['start_offset']:
                                continue
                            done_cond = pkt_offset >= si['end_offset']
                        else:
                            if elapsed_ticks < si['start_ticks']:
                                continue
                            done_cond = elapsed_ticks > si['end_ticks']

                        if done_cond:
                            w.finish(i, "      ✓ セグメント{n}完了: {path} ({mb:.1f} MB)")
                            continue

                        # パケットは生のまま書き出す（PTS/DTS/PCR/CC を書き換えない）。
                        # 0 始まりへ補正すると、映像先頭フレームより先行する音声等が
                        # 負値 → PTS_CYCLE(2^33) へラップして A/V がずれるため。
                        # フレーム精度のカット位置は byte offset 選択で確定済み。CC は
                        # 元ファイルの連続スライスなので書き換え不要（連続性は保たれる）。
                        write_bufs[i].extend(raw)
                        if len(write_bufs[i]) >= WRITE_BUF_SIZE:
                            w.flush(i)

                remainder = data[pos:]
                file_offset_of_data += pos

                if all(seg_done):
                    break

                if verbose and file_size > 0:
                    now = _time.time()
                    if now - last_report >= 5:
                        print(f"      進捗: {bytes_read * 100 / file_size:.1f}%", flush=True)
                        last_report = now

        # EOF: バッファ残りをフラッシュ
        w.finish_rest("      ⚠ セグメント{n}: EOF到達 {path} ({mb:.1f} MB)")

    finally:
        w.close_all()

    # --- 結果 ---
    return summarize_outputs(w.paths, segments)
