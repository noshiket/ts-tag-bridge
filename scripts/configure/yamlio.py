"""config.yml の読み書き（コメントと見本の字下げを残す）"""

from ruamel.yaml import YAML


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    # 見本と同じ字下げ（「key:」の下の「  - 」）
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def load(path: str):
    with open(path, encoding='utf-8') as f:
        return _yaml().load(f)


def dump(cfg, path: str) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        _yaml().dump(cfg, f)


def set_list(parent, key: str, values: list) -> None:
    """一覧を書き換える。中身が同じなら触らない。残る項目はその場で直す（後ろに付いたコメントを残すため。
    次の項目の説明の段落は、一覧の最後の項目に付いている）"""
    seq = parent.get(key)
    if not hasattr(seq, 'ca') or not len(seq):
        parent[key] = values
        return
    if [dict(x) if hasattr(x, 'items') else x for x in seq] == values:
        return
    tail = seq.ca.items.pop(len(seq) - 1, None)   # 最後の項目（文字）に付いたコメント
    for i, v in enumerate(values):
        if i < len(seq) and hasattr(seq[i], 'items') and isinstance(v, dict):
            for k in [k for k in seq[i] if k not in v]:
                del seq[i][k]
            seq[i].update(v)
        elif i < len(seq):
            seq[i] = v
        else:
            seq.append(v)
    del seq[len(values):]
    if tail is not None and len(seq):
        seq.ca.items[len(seq) - 1] = tail
