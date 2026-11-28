"""字幕を描く書体（探す・日本語が出るか・状態）"""

import data_paths
import os


# 日本語が出るフォントの候補（先に見つかったものを使う）
_FONT_CANDIDATES = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def available() -> bool:
    try:
        return True
    except ImportError:
        return False


def find_font() -> str:
    """日本語が出せるフォントを探す。無ければ空文字（豆腐になるので描かない）。"""
    for p in _FONT_CANDIDATES:
        if os.path.isfile(p) and _has_japanese(p):
            return p
    # アドオンが自前で置いたフォント(server/data/addon/*/fonts/)も見る。
    # システムに日本語フォントが無い環境(sudo が使えない等)でも動かせるようにするため。
    roots = [os.path.join(data_paths.DATA_DIR, 'addon'),
             '/usr/share/fonts', '/usr/local/share/fonts', os.path.expanduser('~/.fonts')]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for f in sorted(files):
                if not f.lower().endswith(('.ttc', '.otf', '.ttf')):
                    continue
                path = os.path.join(dirpath, f)
                if _has_japanese(path):
                    return path
    return ''


def _has_japanese(path: str) -> bool:
    """そのフォントで日本語が描けるか（'あ' の字形を持っているか）。"""
    try:
        from fontTools.ttLib import TTFont, TTCollection
        fonts = (TTCollection(path).fonts if path.lower().endswith('.ttc') else [TTFont(path, fontNumber=0)])
        for f in fonts:
            for table in f['cmap'].tables:
                if 0x3042 in table.cmap:      # 'あ'
                    return True
        return False
    except Exception:
        # fontTools が無い/読めない時は、名前で当たりを付ける
        n = os.path.basename(path).lower()
        return any(k in n for k in ('cjk', 'gothic', 'mincho', 'ipa', 'noto sans jp', 'notosansjp'))


def font_status() -> dict:
    """字幕描画に必要なものが揃っているか（設定画面の案内用）。"""
    path = find_font() if available() else ''
    return {
        'pillow': available(),
        'font': path,
        'ok': bool(available() and path),
        'hint': ('' if path else
                 '日本語フォントが見つかりません。sudo apt install fonts-noto-cjk で入れてください'),
    }
