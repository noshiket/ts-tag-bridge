"""tmp_dir — 一時ディレクトリ生成（make_tmp_dir プラグインのロジック流用）"""
import hashlib
import os
from datetime import datetime


def create_tmp_dir(base: str) -> str:
    """base の下にユニークな一時ディレクトリを作成して返す。
    形式: {base}/TMP{YYYYMMDDhhmm}_{md5_8chars}/
    """
    now = datetime.now()
    date_str = now.strftime('%Y%m%d%H%M')
    hash_str = hashlib.md5(now.isoformat().encode()).hexdigest()[:8]
    path = os.path.join(base, f'TMP{date_str}_{hash_str}')
    os.makedirs(path, exist_ok=True)
    return path
