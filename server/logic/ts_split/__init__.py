"""TS の分割（PCR/PTS/DTS の補正つき・キーフレームでの高速分割）。

もとは logic/ts_splitter_core.py（分割の本体）と logic/ts_split.py（入口）。1つにまとめて中身ごとに分けた。
手で動かすときは python -m logic.ts_split。
PCR・PAT/PMT の読み取り（scan_ts_info など）は read_tsprogram.pcr_scan にある。"""
from .recording import split_recording  # noqa: F401
