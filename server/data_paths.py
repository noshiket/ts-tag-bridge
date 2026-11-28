"""このサーバーの置き場（server/）とデータの置き場（config.yml の data_dir。空なら server/data）。

ファイルの場所から割り出さずにここを使う（ファイルをフォルダへ分けると段がずれるため）。

text_parser（packages/text_parser）は、読み込んだ時点でしょぼいカレンダーの規制の状態を
TEXT_PARSER_DATA_DIR から読み戻す。サーバーのどの経路から読み込まれても同じ置き場に
なるよう、text_parser を読み込む api / logic / workers の __init__ と main.py が
最初にこれを読み込む。環境変数は子プロセスにも引き継がれる。
"""

import os
import sys

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(SERVER_DIR, 'data')
# 子プロセス・アドオン・シェルの台本へ置き場を渡す環境変数
DATA_DIR_ENV = 'TSTAG_DATA_DIR'


def _config_path() -> str:
    """起動の引数に config.yml が渡されていればそれ、無ければ server/config.yml"""
    arg = sys.argv[1] if len(sys.argv) > 1 else ''
    if arg.endswith(('.yml', '.yaml')) and os.path.isfile(arg):
        return arg
    return os.path.join(SERVER_DIR, 'config.yml')


def resolve_data_dir(value) -> str:
    """config.yml の data_dir の値 → 置き場。空なら server/data。相対パスは server/ から"""
    p = str(value or '').strip()
    if not p:
        return DEFAULT_DATA_DIR
    return os.path.abspath(os.path.join(SERVER_DIR, os.path.expanduser(p)))


def _data_dir() -> str:
    """環境変数（親のサーバーから引き継いだもの）→ config.yml の data_dir → server/data の順。
    ここは他のどれよりも先に読み込まれ、設定を読む前に決まっている必要があるので、config.yml を自分で読む"""
    env = os.environ.get(DATA_DIR_ENV)
    if env:
        return env
    try:
        import yaml
        with open(_config_path(), encoding='utf-8') as f:
            return resolve_data_dir((yaml.safe_load(f) or {}).get('data_dir'))
    except Exception:
        return DEFAULT_DATA_DIR


DATA_DIR = _data_dir()
os.environ[DATA_DIR_ENV] = DATA_DIR

os.environ.setdefault('TEXT_PARSER_DATA_DIR', DATA_DIR)
