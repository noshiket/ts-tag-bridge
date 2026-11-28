"""共通（ログなど）"""

import logging
from typing import Optional


logger = logging.getLogger('logic.encode_pipeline')   # 分ける前と同じ名前で出す


def _apply_encode_dir(path: Optional[str], encode_dir: Optional[str]) -> Optional[str]:
    """app_output_path 内の {$encode_dir} を encode_dir で置換する。

    encode_dir 未指定 / プレースホルダなしの場合は path をそのまま返す。
    """
    if path and encode_dir and '{$encode_dir}' in path:
        return path.replace('{$encode_dir}', str(encode_dir).rstrip('/'))
    return path


# federation送信用の予約値。実ディレクトリではなく、run_file_copyでencode_dir_listの
# 先頭が利用可能な実ディレクトリへ解決される（_pick_available_encode_dir）。このencode_dirを
# 持つエンコードだけが federation.library_peer へ push される。
FED_MASTER = 'master'
