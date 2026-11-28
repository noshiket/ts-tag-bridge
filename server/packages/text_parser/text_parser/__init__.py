"""text_parser — 番組名・番組情報をパターンで解析し、作品名・話数・副題などを取り出す。

しょぼいカレンダー(shoboi_api / shoboi_store)への問い合わせもここに持つ。
配信サイトなど、ほかから文字を取ってくるアクションはアドオン（actions の fetch_text）で足す。
読み込む前に TEXT_PARSER_DATA_DIR で置き場を渡すこと（_config を参照）。

  parser.py    TextParser（パターンの解析の本体）
  fetchers.py  しょぼいカレンダーから番組の情報を取り出す
  paths.py     パス・ファイル名に使う値の置き換え
  actions.py   アドオンで増やす解析アクション
  __main__.py  python -m text_parser で動かす手動の確かめ

使う側が渡すもの（どれも渡さなければその機能は無いものとして動く）:
  actions.set_addon_source(list_addons, load_addon)  アドオンで増やす解析アクション
"""

from .parser.core import TextParser  # noqa: F401
