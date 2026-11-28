"""DB の移行（列を足す・消す）で共通の扱い"""


def migration_error(e, logger):
    """移行の失敗。列がもうある・もう無い（移行済み）は想定どおりなので黙る。
    それ以外（DB のロック等）は起動を止めずにログへ残す（列が足りないまま動くと後で分かりにくい）。"""
    msg = str(e)
    if 'duplicate column name' in msg or 'no such column' in msg:
        return
    logger.warning('DB の移行に失敗（起動は続ける）: %s: %s', type(e).__name__, msg)
