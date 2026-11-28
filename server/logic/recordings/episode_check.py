"""is_multi_episode — 複数話を示す episode_number 判定"""

import json
import re


def is_multi_episode(episode_number: str) -> bool:
    """複数話を示す episode_number かどうかを判定する。

    対象パターン:
      - JSON 配列 2要素以上: '["7", "8"]'
      - ハイフン・チルダ範囲: "1-3", "1～3", "1〜3"
      - カンマ・中点リスト:   "1,2,3", "1・2"
    """
    if not episode_number:
        return False
    s = str(episode_number)
    # JSON 配列形式: ["7", "8"] など
    if s.startswith('['):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list) and len([x for x in parsed if x not in (None, '')]) >= 2:
                return True
        except (ValueError, TypeError):
            pass
    # 数字-数字 or 数字～数字 or 数字〜数字
    if re.search(r'\d+[-～〜]\d+', s):
        return True
    # 数字,数字 or 数字・数字
    if re.search(r'\d+[,・]\d+', s):
        return True
    return False
