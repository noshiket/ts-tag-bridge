"""動画・画像に埋め込む情報の共通（埋め込みキーとログ）"""

import logging

logger = logging.getLogger('logic.meta.media_meta')   # 埋め込みのログは1つの名前で出す

# 埋め込みキー。ffmpeg のメタデータ名 / PNG の iTXt キーワード共通。
META_KEY = 'encode_auto'
