"""字幕の1画面を描く部品（行をまとめる・文字の並び・1文字）"""

# ARIB のパレット(標準8色)。aribb24.js の既定パレットと同じ並び。
_PALETTE = [
    (0, 0, 0), (255, 0, 0), (0, 255, 0), (255, 255, 0),
    (0, 0, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255),
]
# 縁取りの太さ(文字サイズに対する比)
_STROKE_RATIO = 0.10


def _color(idx, default=(255, 255, 255)):
    """ARIB のパレット番号 → RGB。範囲外は既定色。"""
    try:
        return _PALETTE[int(idx) % 8]
    except (TypeError, ValueError):
        return default


def _merge_lines(marks, gap=8):
    """文字ごとの矩形を行単位にまとめる(帯を1行1本にするため)。"""
    if not marks:
        return []
    lines = {}
    for (x0, y0, x1, y1) in marks:
        key = round(y1 / max(1, gap))          # 下端が近いものを同じ行とみなす
        if key in lines:
            a = lines[key]
            lines[key] = (min(a[0], x0), min(a[1], y0), max(a[2], x1), max(a[3], y1))
        else:
            lines[key] = (x0, y0, x1, y1)
    return list(lines.values())


def _draw_span(img, span, sx, sy, font, marks=None):
    """1つの span(Normal/Ruby)を描く。何か描いたら True。"""
    drew = False
    for kind in ('text', 'ruby'):
        for tok in (span.get(kind) or []):
            if not _draw_token(img, tok, sx, sy, font, small=(kind == 'ruby'), marks=marks):
                continue
            drew = True
    return drew


# ARIB の文字サイズ種別 → (横の倍率, 縦の倍率)。
# Middle(中型)は半角相当で横だけ半分、Small(小型)は縦横とも半分。
_SIZE_SCALE = {'Normal': (1.0, 1.0), 'Middle': (0.5, 1.0), 'Small': (0.5, 0.5)}


def _draw_token(img, tok, sx, sy, font, small=False, marks=None):
    from PIL import Image, ImageDraw

    ch = tok.get('character')
    if not ch:
        return False        # DRCS(外字)やビットマップはここでは描けない
    st = tok.get('state') or {}
    pos = st.get('position') or (0, 0)
    fs = st.get('fontsize') or (36, 36)
    kx, ky = _SIZE_SCALE.get(st.get('size') or 'Normal', (1.0, 1.0))
    if small:                                   # ルビは更に半分
        kx, ky = kx * 0.5, ky * 0.5
    # 実際に置ける升目の大きさ。Middle を無視すると半角カナが全角幅で描かれてはみ出る。
    cw = max(1, int(fs[0] * kx * sx))
    chh = max(1, int(fs[1] * ky * sy))
    fg = _color(st.get('foreground'))

    # いったん正方で描いてから升目の比率へ潰す(Pillow は横方向の縮小を直接できない)
    base = max(8, int(fs[1] * sy))
    stroke = max(1, int(base * _STROKE_RATIO))
    pad = stroke * 2
    tmp = Image.new('RGBA', (base + pad * 2, base + pad * 2), (0, 0, 0, 0))
    try:
        ImageDraw.Draw(tmp).text((pad, base + pad), ch, font=font(base), fill=fg + (255,),
                                 anchor='ls', stroke_width=stroke, stroke_fill=(0, 0, 0, 230))
    except Exception:
        return False
    scaled = tmp.resize((max(1, int(cw * (tmp.width / base))),
                         max(1, int(chh * (tmp.height / base)))), Image.LANCZOS)
    # ARIB の position は表示領域(area)の中での座標なので、余白(margin)を足して
    # plane 上の絶対位置にする。これを忘れると字幕全体が左上へずれる。
    mx, my = st.get('margin') or (0, 0)
    # position は文字の左下。左上原点へ直して貼る
    x = int((mx + pos[0]) * sx) - int(pad * cw / base)
    y = int((my + pos[1]) * sy) - chh - int(pad * chh / base)
    img.alpha_composite(scaled, (max(0, x), max(0, y)))
    if marks is not None and not small:
        marks.append((x, y, x + scaled.width, y + scaled.height))
    return True
