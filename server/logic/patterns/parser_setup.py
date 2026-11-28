"""text_parser（packages/text_parser）へ、このサーバーの持ち物を渡す。

- 解析アクションを増やすアドオン（server/addon/ の target='parser_action'）

文字を取ってくるアクション（副題の取得など）と、それが使う表（sid → 放送局名など）は
それぞれのアドオンが持つ。コアはアドオンの名前を知らない。
"""

from text_parser import actions


def setup(rule_db_path: str) -> None:
    from logic.addons import addon_runner
    actions.set_addon_source(addon_runner.list_addons, addon_runner.load_addon)
