"""text_parser が手元に置くファイルの置き場。

しょぼいカレンダーの規制の状態(shoboi_rate_limit.json)と、問い合わせの記憶・
番組表(shoboi_cache.db)をここに置く。規制の状態は読み込んだ時点で読み戻すので、
置き場は読み込む前に環境変数 TEXT_PARSER_DATA_DIR で渡す。

推測はしない。間違った場所で始めると規制の記録が無いまま問い合わせてしまい、
しょぼいカレンダーの bot 利用規約(回数の上限・規制中の停止)を守れなくなるため。
"""

import os

ENV = 'TEXT_PARSER_DATA_DIR'


def data_dir() -> str:
    d = os.environ.get(ENV)
    if not d:
        raise RuntimeError(
            f'{ENV} が未設定です。text_parser を読み込む前に、規制の状態と問い合わせの記憶を'
            f'置くフォルダを {ENV} で渡してください')
    return d
