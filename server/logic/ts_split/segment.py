"""分割する区間と、区間の読み込み（JSON ファイル・辞書の並び）"""

import json
from dataclasses import dataclass
from typing import List


@dataclass
class Segment:
    """分割セグメント定義"""
    start_time: float           # 開始時刻（秒、0 = ファイル先頭PCR基準）
    end_time: float             # 終了時刻（秒）
    output_filename: str        # 出力ファイル名
    output_folder: str = ''     # 出力サブフォルダ（省略可）

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    def __post_init__(self):
        if self.duration <= 0:
            raise ValueError(f"無効なセグメント: duration={self.duration:.3f}s "
                             f"({self.start_time} → {self.end_time})")


def load_segments_from_json(json_path: str) -> List[Segment]:
    """
    セグメントJSONファイルを読み込む。

    JSONフォーマット:
        [
            {
                "start_time": 0.0,
                "end_time": 1500.0,
                "output_filename": "ep01.ts",
                "output_folder": "MyShow"  // 省略可
            }
        ]
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, dict) and 'segments' in data:
        data = data['segments']

    segments = []
    for item in data:
        seg = Segment(
            start_time=float(item['start_time']),
            end_time=float(item['end_time']),
            output_filename=item['output_filename'],
            output_folder=item.get('output_folder', '')
        )
        segments.append(seg)

    return segments


def segments_from_dict_list(seg_list: List[dict]) -> List[Segment]:
    """
    辞書リストからSegmentリストを生成（Webアプリからの呼び出し用）。

    辞書キー（detail.htmlのsegments配列と同形式）:
        start_time, end_time, output_filename, output_folder
    """
    segments = []
    for item in seg_list:
        seg = Segment(
            start_time=float(item.get('start_time', 0)),
            end_time=float(item.get('end_time', 0)),
            output_filename=item.get('output_filename', 'output.ts'),
            output_folder=item.get('output_folder', '')
        )
        segments.append(seg)
    return segments
