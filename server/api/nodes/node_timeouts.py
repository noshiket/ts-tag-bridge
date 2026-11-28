"""他のサーバーへ中継する時の待ち時間（パスごと）"""

import re


# パス毎のread timeout(秒)。connectは常に3秒固定。録画のTSスキャン/再解析はLLM解析込みで
# 分単位になりうる。動画系(フレーム抽出/HLSセグメント/video_stream/probe)はオンデマンド
# エンコードのコールドスタートで数十秒かかることがあるため、クライアント側の許容値
# (fragLoadingTimeOut=60000ms、stream.jsx)より長めに設定する。
# 一致無しはデフォルト25秒。stream=Trueで送るためread timeoutは「チャンク間隔」に適用され、
# 長時間ストリーム(video_stream等)でも問題ない。
_FED_READ_TIMEOUT = [
    (re.compile(r'^/api/encode/recordings/\d+/(scan_eit|scan_eit_head|extract_logo|reparse)$'), 600),
    (re.compile(r'^/api/streams/video/\d+/[^/]+/segment$'), 90),
    (re.compile(r'^/api/streams/vdb/\d+/[^/]+/segment$'), 90),
    (re.compile(r'^/api/streams/vdb/\d+/thumbnail-tile$'), 90),
    # マスターへの移動は実ファイル転送を伴い分単位になる
    (re.compile(r'^/api/videos/\d+/relocate$'), 3600),
    (re.compile(r'^/api/encode/recordings/\d+/(frame|video_stream|probe|thumbnail-tile)$'), 90),
    (re.compile(r'^/api/encode/recordings/\d+/hls/seg\.ts$'), 90),
    # ライブ視聴: mpegtsは連続チャンクだがチューナー起動で数十秒空くことがあり、
    # SSE(events)はステータス変化まで分単位でチャンクが来ないため長めに取る。
    (re.compile(r'^/api/streams/live/[^/]+/'), 3600),
]


_DEFAULT_READ_TIMEOUT = 25


def _read_timeout_for(path: str) -> int:
    for rx, timeout in _FED_READ_TIMEOUT:
        if rx.match(path):
            return timeout
    return _DEFAULT_READ_TIMEOUT
