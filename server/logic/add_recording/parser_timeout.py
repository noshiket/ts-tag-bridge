"""text_parser を時間切れつきで動かす（止まった解析で録画の登録を詰まらせない）"""

import contextvars
import threading


# text_parser(しょぼいカレンダー・配信サイト・Wikipedia への問い合わせを含む)に許す時間(秒)。
# 録画の取り込みは1本ずつ直列なので、ここが固まると後ろの録画が全部「解析待ち」のまま
# TS だけが溜まる（実測: しょぼいカレンダーの 429 の待ちで、片方のサーバーの録画 6116 が
# 17分以上、別のサーバーの 3531 が5時間以上止まり、24件 79GB が解析待ちに溜まった）。
# 通常は数秒〜数十秒で終わる（外部への問い合わせは1件ごとに 1.5秒以上あけるため、
# 題名ひとつで何度も引くものでも数分に収まる）。
_TEXT_PARSER_TIMEOUT_SEC = 300


def _parse_with_timeout(parser, title, context, seconds=None):
    """parser.parse_text を別スレッドで走らせ、seconds 秒で打ち切って TimeoutError にする。

    スレッドは外から止められないので、打ち切った後も裏で走り終えるまで残る（daemon なので
    プロセスの終了は妨げない）。呼び出し側が先へ進めることが目的。
    """
    seconds = _TEXT_PARSER_TIMEOUT_SEC if seconds is None else seconds
    box = {}

    def run():
        try:
            box['result'] = parser.parse_text(title, context=context)
        except BaseException as e:      # 呼び出し側へそのまま渡す
            box['error'] = e

    # background()（しょぼいカレンダーの上限の取り分）を別スレッドへ引き継ぐ
    t = threading.Thread(target=contextvars.copy_context().run, args=(run,),
                         name='AddRecordingTextParser', daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        raise TimeoutError(f'text_parser が {seconds}秒で終わりませんでした')
    if 'error' in box:
        raise box['error']
    return box.get('result')
