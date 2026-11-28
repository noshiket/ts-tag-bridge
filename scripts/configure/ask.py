"""質問の部品。端末につながっていない時（自動で流す時）は聞かずに既定の値を使う。"""

import sys

INTERACTIVE = sys.stdin.isatty()


def say(msg: str = '') -> None:
    print(msg, flush=True)


def ask(question: str, default: str = '') -> str:
    """文字を聞く。空で Enter なら既定の値"""
    if not INTERACTIVE:
        return default
    hint = f' [{default}]' if default else ''
    try:
        got = input(f'  {question}{hint}: ').strip()
    except EOFError:
        return default
    return got or default


def yes(question: str, default: bool = True) -> bool:
    """はい・いいえを聞く"""
    if not INTERACTIVE:
        return default
    hint = '[Y/n]' if default else '[y/N]'
    try:
        got = input(f'  {question} {hint}: ').strip().lower()
    except EOFError:
        return default
    return default if not got else got in ('y', 'yes', 'はい')


def choose(question: str, options: list, default: str) -> str:
    """一覧から選ぶ。options は [(値, 説明)]。番号でも値でも答えられる"""
    if not INTERACTIVE:
        return default
    say(f'  {question}')
    for i, (value, label) in enumerate(options, 1):
        mark = '*' if value == default else ' '
        say(f'   {mark}{i}. {value:10} {label}')
    while True:
        got = ask('番号か名前', default)
        if got.isdigit() and 1 <= int(got) <= len(options):
            return options[int(got) - 1][0]
        for value, _ in options:
            if got.lower() == value.lower():
                return value
        say('  一覧の番号か名前で答えてください')
