"""arib_render — ARIB字幕をプレイヤーと同じ見た目で画像に描く。

字幕の解析と配置計算は同梱の aribb24js(Python移植・read_tsprogram/aribb24js)が
そのまま使える。ブラウザ版は canvas に描いているが、サーバー側にはその部分が無いので
ここで Pillow を使って同じ配置・同じ色で PNG にする（切り抜き時の焼き込み用）。

ASS に落とす方法もあるが、位置・文字サイズ・色・ルビ・外字(DRCS)の再現が甘くなるため、
プレイヤーと同じ見た目にしたい場合はこちらを使う。

Pillow が無い環境では import に失敗するので、呼び出し側は available() で確認すること。
"""

import logging

from .arib_draw import _draw_span, _merge_lines
from .arib_fonts import find_font

logger = logging.getLogger(__name__)


def parse_screen(tokens, ruby='GUESS_RUBY'):
    """保存済みトークン列 → 描画用の region 一覧。解析できなければ空。"""
    import sys
    from pathlib import Path
    # aribb24js は read_tsprogram 直下のパッケージだが、その中は
    # `from lib.tokenizer... import` とトップレベルの lib を参照する。read_tsprogram
    # だけ通しても aribb24js 自身が sys.path に無いと No module named 'lib' で落ちる。
    # どちらが先に読み込まれるかで結果が変わるため、両方入れる。
    import read_tsprogram
    rtp = Path(read_tsprogram.__file__).resolve().parent
    for d in (str(rtp), str(rtp / 'aribb24js')):
        if d not in sys.path:
            sys.path.insert(0, d)
    try:
        from aribb24js.lib.parser.parser import ARIBB24Parser
        from aribb24js.lib.parser.regioner import regioner_default
        parsed = ARIBB24Parser().parse(tokens or [])
        return regioner_default(parsed, {'association': 'ARIB', 'language': 'jpn'}, ruby) or []
    except Exception as e:
        logger.debug('字幕の解析に失敗: %s', e)
        return []


def render_screen(regions, width, height, font_path=None, scale=None):
    """region 一覧 → RGBA の PIL 画像。描くものが無ければ None。

    width/height は出力する動画の解像度。字幕の座標系(plane)から拡大縮小する。
    """
    from PIL import Image, ImageDraw, ImageFont

    if not regions:
        return None
    plane = regions[0].get('plane') or (1920, 1080)
    sx = width / float(plane[0] or width)
    sy = height / float(plane[1] or height)
    if scale:
        sx *= scale
        sy *= scale

    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    font_path = font_path or find_font()
    if not font_path:
        logger.warning('日本語フォントが見つからないため字幕を描けません'
                       '(sudo apt install fonts-noto-cjk)')
        return None
    cache = {}

    def font(px):
        px = max(8, int(px))
        if px not in cache:
            try:
                cache[px] = ImageFont.truetype(font_path, px)
            except Exception:
                cache[px] = ImageFont.load_default()
        return cache[px]

    # 先に文字を描いて、その外接矩形に合わせて背景帯を敷く。
    # region の position/area は行送り前の値のことがあり、そのまま帯にすると文字とずれる。
    drew = False
    marks = []
    for region in regions:
        for span in region.get('spans') or []:
            got = _draw_span(img, span, sx, sy, font, marks)
            drew = got or drew
    if not drew:
        return None
    bg = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    bgd = ImageDraw.Draw(bg)
    for (x0, y0, x1, y1) in _merge_lines(marks):
        bgd.rectangle([x0 - 6, y0 - 4, x1 + 6, y1 + 4], fill=(0, 0, 0, 140))
    return Image.alpha_composite(bg, img)


def screens_for_range(captions, start, end):
    """captions_json の captions → [{'start','end','tokens'}]（区間で絞り込み済み）。

    ClearScreen で1画面を区切り、次の画面が出るまでを表示区間にする
    （前の Web 版の字幕の描き方と同じ区切り）。
    """
    groups, cur = [], None
    for cp in captions or []:
        tokens = cp.get('tokens') or []
        if any(t.get('tag') == 'ClearScreen' for t in tokens) or cur is None:
            if cur is not None:
                groups.append(cur)
            cur = {'start': float(cp.get('pts') or 0), 'end': None, 'tokens': []}
        cur['tokens'].extend(tokens)
    if cur is not None:
        groups.append(cur)
    for i in range(len(groups) - 1):
        groups[i]['end'] = groups[i + 1]['start']
    if groups:
        groups[-1]['end'] = groups[-1]['start'] + 5.0

    out = []
    for g in groups:
        s, e = g['start'] - start, (g['end'] or 0) - start
        if e <= 0 or (end is not None and s > (end - start)):
            continue
        # 文字が1つも無い画面(消去だけ)は捨てる
        if not any(t.get('tag') == 'Character' for t in g['tokens']):
            continue
        out.append({'start': max(0.0, s), 'end': max(0.01, e), 'tokens': g['tokens']})
    return out
