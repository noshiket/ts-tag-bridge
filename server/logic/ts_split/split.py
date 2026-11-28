"""区間で分ける（split_ts）。PCR だけで区間を決め、パケットは書き換えない"""

import os
from typing import List, Optional, Tuple
from read_tsprogram.constants import SYNC_BYTE, TS_PACKET_SIZE
from read_tsprogram.pcr_scan import PCR_CLOCK_HZ, PCR_WRAP, pcr_elapsed, pcr_to_sec, scan_ts_info, sec_to_pcr
from .segment import Segment
from .output import summarize_outputs
from .writers import WRITE_BUF_SIZE, SegmentWriters, read_pcr


# =============================================================================
# メイン分割処理
# =============================================================================

def split_ts(
    ts_path: str,
    segments: List[Segment],
    output_dir: str = '',
    verbose: bool = True,
) -> Tuple[bool, str, List[str]]:
    """
    TSファイルをPCRベースで分割する。

    Args:
        ts_path: 入力TSファイルパス
        segments: 分割セグメントリスト
        output_dir: 出力先ディレクトリ（空の場合は入力ファイルと同じ場所）
        verbose: 進捗を標準出力に表示するか

    Returns:
        (success, message, output_file_paths)
    """
    # --- 入力検証 ---
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

    if info.pcr_pid is None:
        return False, "PCR PIDが見つかりませんでした", []
    if info.initial_pcr is None:
        return False, "初期PCR値が取得できませんでした", []

    if verbose:
        print(f"      PCR PID : 0x{info.pcr_pid:04X} ({info.pcr_pid})")
        print(f"      初期PCR : {info.initial_pcr} = {pcr_to_sec(info.initial_pcr):.3f}秒")
        print(f"      PAT     : {'あり' if info.pat_packets else 'なし'}")
        print(f"      PMT     : {len(info.pmt_packets)}件")

    # --- セグメントのPCR境界値を事前計算 ---
    seg_ranges = []
    for seg in segments:
        start_pcr = (info.initial_pcr + sec_to_pcr(seg.start_time)) % PCR_WRAP
        end_pcr = (info.initial_pcr + sec_to_pcr(seg.end_time)) % PCR_WRAP
        seg_ranges.append((start_pcr, end_pcr))
        if verbose:
            print(f"      セグメント {seg.start_time:.1f}s → {seg.end_time:.1f}s  "
                  f"(PCR {sec_to_pcr(seg.start_time):,} + {info.initial_pcr:,})")

    # --- Phase 2: 出力ファイル準備 ---
    if verbose:
        print(f"[2/3] 出力ファイル準備中 ({len(segments)}件)")

    w = SegmentWriters(segments, output_dir, info, verbose)
    out_handles, write_bufs, seg_done = w.handles, w.bufs, w.done
    try:
        w.open_all()

        # --- Phase 3: パケット仕分け ---
        if verbose:
            print(f"[3/3] 分割処理中...", flush=True)

        import time as _time
        file_size = os.path.getsize(ts_path)
        current_pcr: Optional[int] = None
        bytes_read = 0
        last_report_time = _time.time()

        # --- 最適化: セグメント境界のtick値・最も早い開始tickを事前計算 ---
        seg_tick_ranges = [(pcr_elapsed(s, info.initial_pcr), pcr_elapsed(e, info.initial_pcr))
                           for s, e in seg_ranges]
        earliest_start_ticks = min(s for s, e in seg_tick_ranges)

        # --- 最適化: ローカル変数バインディング ---
        _pcr_pid = info.pcr_pid
        _initial_pcr = info.initial_pcr
        _SYNC = SYNC_BYTE
        _PKT_SIZE = TS_PACKET_SIZE
        _PCR_HZ = PCR_CLOCK_HZ
        _PCR_WRAP = PCR_WRAP
        n_segments = len(segments)

        with open(ts_path, 'rb') as f:
            remainder = b''
            elapsed_sec = 0.0
            while True:
                chunk = f.read(_PKT_SIZE * 4096)
                if not chunk:
                    break
                bytes_read += len(chunk)

                data = remainder + chunk
                mv = memoryview(data)
                pos = 0

                # 同期バイト検索
                while pos < len(mv) and mv[pos] != _SYNC:
                    pos += 1

                while pos + _PKT_SIZE <= len(mv):
                    if mv[pos] != _SYNC:
                        next_sync = data.find(_SYNC, pos + 1)
                        if next_sync < 0:
                            pos = len(mv)
                            break
                        pos = next_sync
                        continue

                    packet = mv[pos:pos + _PKT_SIZE]
                    pos += _PKT_SIZE
                    pid = ((packet[1] & 0x1F) << 8) | packet[2]

                    # --- PCR 更新 ---
                    if pid == _pcr_pid:
                        new_pcr = read_pcr(packet)
                        if new_pcr is not None:
                            if current_pcr is not None and new_pcr - current_pcr < -_PCR_HZ * 2 and verbose:
                                print(f"      PCR不連続検出: {elapsed_sec:.1f}秒付近", flush=True)
                            current_pcr = new_pcr

                    if current_pcr is None:
                        continue

                    # --- インライン pcr_elapsed ---
                    elapsed_ticks = current_pcr - _initial_pcr
                    if elapsed_ticks < 0:
                        elapsed_ticks += _PCR_WRAP
                    elapsed_sec = elapsed_ticks / _PCR_HZ

                    # --- 最適化: セグメント開始前のパケットをスキップ ---
                    if elapsed_ticks < earliest_start_ticks:
                        continue

                    # --- セグメントへの書き込み（事前計算済みtick値を使用） ---
                    for i in range(n_segments):
                        if out_handles[i] is None:
                            continue
                        seg_start_ticks, seg_end_ticks = seg_tick_ranges[i]
                        if seg_start_ticks <= elapsed_ticks <= seg_end_ticks:
                            write_bufs[i].extend(packet)
                            if len(write_bufs[i]) >= WRITE_BUF_SIZE:
                                w.flush(i)
                        elif not seg_done[i] and elapsed_ticks > seg_end_ticks:
                            w.finish(i, "      ✓ セグメント{n}完了: {path} ({mb:.1f} MB)")

                remainder = bytes(mv[pos:])  # 最大 187 バイト

                # 全セグメント完了したら即終了
                if all(seg_done):
                    break

                # 5秒ごとに進捗を表示
                if verbose and file_size > 0:
                    now = _time.time()
                    if now - last_report_time >= 5:
                        progress = bytes_read * 100 / file_size
                        print(f"      進捗: {progress:.1f}% (位置: {elapsed_sec:.1f}秒)", flush=True)
                        last_report_time = now

        # EOF到達: バッファをflushしてファイルを閉じる
        w.finish_rest("      ⚠ セグメント{n}終了時刻がファイル終端を超えたためクランプ: {path} ({mb:.1f} MB)")

        if verbose:
            print()

    finally:
        # 必ずバッファをflushしてファイルを閉じる
        w.close_all()

    # --- 結果集計 ---
    return summarize_outputs(w.paths, segments, verbose)
