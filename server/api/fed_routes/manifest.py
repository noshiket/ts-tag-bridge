"""送られてきたものの目録（manifest.json）を読む"""

import json
from typing import Optional
from .common import _manifest_path


def _load_manifest(tdir: str) -> Optional[dict]:
    try:
        with open(_manifest_path(tdir), encoding='utf-8') as f:
            return json.load(f)
    except OSError:
        return None
