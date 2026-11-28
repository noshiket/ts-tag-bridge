import hashlib
import logging

logger = logging.getLogger('db.user_db')   # 分ける前と同じ名前で出す


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
