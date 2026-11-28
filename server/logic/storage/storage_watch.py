"""起動時に EDCB の録画フォルダ容量を前回と突き合わせ、変わっていたら知らせる。

EDCB を Docker で起動した時にマウントが失敗すると、パスは在るのに実体はコンテナ側の
ディスクという状態になる。EDCB は書き込み先を起動時の設定で決めるため、そのまま
録画するとマウントされていない場所へ書いてしまう。

ファイルシステムの容量は正しくマウントされていれば変わらない。EDCB 自身が見ている
容量(Common?storage=1)を前回と比べ、違っていれば別のディスクを指している。
EDCB の視点で測るのが要点で、こちら側から stat しても EDCB のマウント状態は分からない。

見るのは起動時の1回だけ（EDCB が書き込み先を決めるのも起動時なので、そこで気づけば足りる）。
前回の値は data/storage_capacity.json に置く。
"""

import json
import logging
import os

logger = logging.getLogger(__name__)

# 容量のゆらぎ。同じディスクでも予約ブロック等で多少動くので、超えた時だけ知らせる
TOLERANCE = 0.005      # 0.5%
FILE_NAME = 'storage_capacity.json'


def _path(data_dir: str) -> str:
    return os.path.join(data_dir, FILE_NAME)


def load(data_dir: str) -> dict:
    try:
        with open(_path(data_dir), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(data_dir: str, folders: dict) -> None:
    os.makedirs(data_dir, exist_ok=True)
    tmp = _path(data_dir) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(folders, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _path(data_dir))


def _by_name(storage) -> dict:
    """EDCB の応答を {録画フォルダ: 総容量} にする。"""
    out = {}
    for s in (storage or []):
        name, total = s.get('name'), s.get('total')
        if name and total:
            out[str(name)] = int(total)
    return out


def diff(before: dict, after: dict) -> list:
    """前回と今回の差。戻り: [{'name','before','after','gone','added'}]"""
    changes = []
    for name, total in after.items():
        prev = before.get(name)
        if prev is None:
            changes.append({'name': name, 'before': None, 'after': total,
                            'gone': False, 'added': True})
        elif abs(total - prev) / max(prev, 1) > TOLERANCE:
            changes.append({'name': name, 'before': prev, 'after': total,
                            'gone': False, 'added': False})
    for name, prev in before.items():
        if name not in after:
            changes.append({'name': name, 'before': prev, 'after': None,
                            'gone': True, 'added': False})
    return changes


def describe(c: dict) -> str:
    def tb(n):
        if not n:
            return '-'
        return f'{n / 1024 ** 4:.2f}TB' if n >= 1024 ** 4 else f'{n / 1024 ** 3:.1f}GB'

    if c.get('gone'):
        return f'{c["name"]}: 一覧から消えました（前回 {tb(c["before"])}）'
    if c.get('added'):
        return f'{c["name"]}: 追加されました（{tb(c["after"])}）'
    return f'{c["name"]}: {tb(c["before"])} → {tb(c["after"])}'


def check(client, data_dir: str) -> list:
    """EDCB に今の容量を聞いて前回と比べ、変化を返す（今回の値を控える）。

    初回（前回の記録が無い）は控えるだけで何も返さない。
    """
    after = _by_name(client.get_storage())
    if not after:
        logger.warning('storage_watch: EDCB から録画フォルダの容量を取れませんでした')
        return []
    before = load(data_dir)
    changes = diff(before, after) if before else []
    save(data_dir, after)
    return changes
