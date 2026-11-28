"""確認用の短命 JWT（1時間・管理者）を出す。アプリの画面をブラウザで確かめる時に Cookie に入れる。

usage: server/.venv/bin/python apps/app/e2e/app_token.py
"""
import os
import sqlite3
import sys
import warnings
from datetime import datetime, timedelta, timezone

warnings.filterwarnings('ignore')
SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'server')
sys.path.insert(0, SERVER)

import jwt  # noqa: E402
import yaml  # noqa: E402

import data_paths  # noqa: E402  データの置き場（config.yml の data_dir。空なら server/data）


def admin_token() -> str:
    cfg = yaml.safe_load(open(os.path.join(SERVER, 'config.yml'), encoding='utf-8')) or {}
    uid = sqlite3.connect(f"file:{os.path.join(data_paths.DATA_DIR, 'users.db')}?mode=ro", uri=True).execute(
        'SELECT id FROM users WHERE is_admin=1 ORDER BY id LIMIT 1').fetchone()[0]
    return jwt.encode({'sub': str(uid), 'exp': datetime.now(timezone.utc) + timedelta(hours=1)},
                      cfg.get('jwt_secret', 'ea_default_secret_change_me'), algorithm='HS256')


if __name__ == '__main__':
    print(admin_token())
