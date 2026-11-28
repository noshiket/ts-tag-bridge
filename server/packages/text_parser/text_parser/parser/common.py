from typing import List


# どのパターンにもマッチしなかった時の parser_error。マッチ失敗も「解析できていない」
# 状態として一覧・詳細で見えるようにするため、解析結果を保存する側はこれを入れる。
NO_MATCH_ERROR = 'どのパターンにもマッチしませんでした'


def parser_errors(result) -> List[str]:
    """解析結果から parser_error を取り出す。マッチしなかった(結果が空)時も1件返す。"""
    if not result:
        return [NO_MATCH_ERROR]
    return list(result.get('parser_error') or [])


def _pa_branch_key(config):
    """analyze 設定が「分岐アドオン」なら、そのキーを返す。違えば None。"""
    try:
        from .. import actions as parser_actions
    except Exception:
        return None
    for k in config:
        if not isinstance(k, str):
            continue
        a = parser_actions.find(k)
        if a and a.get('branching'):
            return k
    return None


class _PatternTextNotFoundError(Exception):
    """pattern ブロックの text 変数が解決できなかったことを示す内部例外"""
    pass
