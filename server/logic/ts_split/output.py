"""分割・結合の出力ファイルまわりで共通の補助（開く・PAT/PMT を書く・結果をまとめる）。"""

import os
from typing import List, Tuple

from read_tsprogram.pcr_scan import TSInfo
from .segment import Segment


def write_pat_pmt(f, info: TSInfo) -> None:
    """出力の先頭に PAT/PMT を書く（後続のデコーダーが番組を見つけられるように）。"""
    for pat_pkt in info.pat_packets:
        f.write(pat_pkt)
    for pmt_pkt in info.pmt_packets.values():
        f.write(pmt_pkt)


def open_segment_output(seg: Segment, output_dir: str, info: TSInfo):
    """セグメントの出力ファイルを作り、PAT/PMT を書いて (パス, 開いたファイル) を返す。"""
    full_dir = os.path.join(output_dir, seg.output_folder) if seg.output_folder else output_dir
    os.makedirs(full_dir, exist_ok=True)
    out_path = os.path.join(full_dir, seg.output_filename)
    fh = open(out_path, 'wb')
    write_pat_pmt(fh, info)
    return out_path, fh


def summarize_outputs(out_paths: List[str], segments: List[Segment],
                      verbose: bool = False) -> Tuple[bool, str, List[str]]:
    """中身のある出力を成功、空のものを失敗として (success, message, 成功したパス) にまとめる。"""
    success_paths = []
    failed = []
    for i, path in enumerate(out_paths):
        if path and os.path.isfile(path) and os.path.getsize(path) > 0:
            success_paths.append(path)
            if verbose:
                size_mb = os.path.getsize(path) / (1024 * 1024)
                print(f"      ✓ {path} ({size_mb:.1f} MB)")
        elif path:
            failed.append(segments[i].output_filename)
            if verbose:
                print(f"      ✗ {path} (空ファイル)")

    if success_paths:
        msg = f"{len(success_paths)}件分割完了"
        if failed:
            msg += f"、{len(failed)}件失敗: {', '.join(failed)}"
        return True, msg, success_paths
    return False, "全セグメントの分割に失敗しました", []
