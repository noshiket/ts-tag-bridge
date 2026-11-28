"""burn_subs — 字幕(ARIB)とコメント(弾幕)を ASS にして動画へ焼き込めるようにする。

切り抜きのアドオンから使う。プレイヤーは字幕を aribb24js、
コメントを canvas で重ねているが、切り出した MP4 単体でも見えるようにするには
映像に焼き込む必要があるため、ここで ASS 字幕へ変換する。

  字幕   … captions_json の Character トークンを ClearScreen 区切りで1画面ぶんに
           まとめ、次の画面が出るまで表示する(プレイヤーの buildScreenGroups と同じ区切り)。
  コメント… comments_json の {time, text, color, type} を
           type='right' は右→左へ流れる(\\move)、'top'/'bottom' は固定表示にする。
           重ならないよう行(レーン)を割り当てる。

時刻は動画先頭からの秒。切り抜き区間に合わせて平行移動し、区間外は落とす。
"""

import logging
import re

logger = logging.getLogger(__name__)

# 既定の画面サイズ(実際の解像度は呼び出し側が渡す)
_DEF_W, _DEF_H = 1920, 1080
# コメントが画面を横切る秒数(プレイヤーの既定と揃える)
SCROLL_SEC = 4.0
# 固定コメント(top/bottom)の表示秒数
FIXED_SEC = 3.0


def _ass_time(sec: float) -> str:
    s = max(0.0, float(sec))
    h = int(s // 3600)
    m = int(s % 3600 // 60)
    return f'{h}:{m:02d}:{s % 60:05.2f}'


def _esc(text: str) -> str:
    """ASS のイベント行に入れられる形にする。"""
    return (str(text or '').replace('\\', '\\\\').replace('{', '(').replace('}', ')')
            .replace('\r', '').replace('\n', '\\N'))


def _color(hex_str: str) -> str:
    """'#RRGGBB' → ASS の &HBBGGRR&。読めなければ白。"""
    m = re.fullmatch(r'#?([0-9a-fA-F]{6})', str(hex_str or ''))
    if not m:
        return '&H00FFFFFF'
    v = m.group(1)
    return f'&H00{v[4:6]}{v[2:4]}{v[0:2]}'.upper()


# ---------------------------------------------------------------------------
# 字幕(ARIB)
# ---------------------------------------------------------------------------

def caption_screens(captions: list) -> list:
    """captions_json の captions → [{'start','end','text'}]。

    ClearScreen で1画面を区切り、次の画面が出るまでを表示区間にする
    (前の Web 版の字幕の描き方と同じ考え方)。
    """
    screens, cur = [], None
    for cp in captions or []:
        tokens = cp.get('tokens') or []
        cleared = any(t.get('tag') == 'ClearScreen' for t in tokens)
        if cleared or cur is None:
            if cur is not None and cur['text']:
                screens.append(cur)
            cur = {'start': float(cp.get('pts') or 0), 'end': None, 'text': ''}
        parts = []
        for t in tokens:
            tag = t.get('tag')
            if tag == 'Character' and not t.get('non_spacing'):
                parts.append(t.get('character') or '')
            elif tag == 'ActivePositionSet':
                parts.append('\n')          # 行送り
        cur['text'] = (cur['text'] + ''.join(parts)).strip('\n')
    if cur is not None and cur['text']:
        screens.append(cur)

    for i in range(len(screens) - 1):
        screens[i]['end'] = screens[i + 1]['start']
    if screens:
        screens[-1]['end'] = screens[-1]['start'] + 5.0     # 最後の画面は5秒出す
    # 空文字・0秒以下の区間は落とす
    return [s for s in screens if s['text'].strip() and (s['end'] or 0) > s['start']]


# ---------------------------------------------------------------------------
# コメント(弾幕)
# ---------------------------------------------------------------------------

def _lanes(items, lane_count: int, dur: float):
    """重ならないよう行(レーン)を割り当てる。空きが無ければ落とす。"""
    free = [0.0] * lane_count     # レーンごとの「次に空く時刻」
    out = []
    for it in items:
        t = it['time']
        lane = next((i for i, until in enumerate(free) if until <= t), None)
        if lane is None:
            continue              # 全レーン埋まっている＝画面が飽和しているので捨てる
        free[lane] = t + dur
        out.append((lane, it))
    return out


def comment_events(comments: list, width: int, height: int, font_px: int):
    """コメント → ASS のイベント行(dialogue)のリスト。"""
    scroll, top, bottom = [], [], []
    for c in comments or []:
        text = (c.get('text') or '').strip()
        if not text:
            continue
        item = {'time': float(c.get('time') or 0), 'text': text, 'color': c.get('color')}
        kind = c.get('type')
        (top if kind == 'top' else bottom if kind == 'bottom' else scroll).append(item)
    for lst in (scroll, top, bottom):
        lst.sort(key=lambda x: x['time'])

    lane_h = int(font_px * 1.2)
    lanes = max(1, height // lane_h - 1)
    events = []

    # 流れるコメント: 右外→左外へ一定速度で動かす
    for lane, it in _lanes(scroll, lanes, SCROLL_SEC * 0.5):
        y = lane_h * (lane + 1)
        w = font_px * len(it['text'])          # 大まかな幅(等幅とみなす)
        start, end = it['time'], it['time'] + SCROLL_SEC
        events.append(
            f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},dm,,0,0,0,,"
            f"{{\\move({width + w // 2},{y},{-w // 2},{y})\\c{_color(it['color'])}}}{_esc(it['text'])}")

    # 固定コメント(上/下)
    for items, anchor, base_y in ((top, 8, lane_h), (bottom, 2, lane_h)):
        for lane, it in _lanes(items, max(1, lanes // 2), FIXED_SEC):
            y = base_y + lane_h * lane
            events.append(
                f"Dialogue: 0,{_ass_time(it['time'])},{_ass_time(it['time'] + FIXED_SEC)},dm,,0,0,0,,"
                f"{{\\an{anchor}\\pos({width // 2},{y if anchor == 8 else height - y})"
                f"\\c{_color(it['color'])}}}{_esc(it['text'])}")
    return events


# ---------------------------------------------------------------------------
# ASS 組み立て
# ---------------------------------------------------------------------------

def build_ass(captions=None, comments=None, *, width=_DEF_W, height=_DEF_H,
              start=0.0, end=None, font='Noto Sans CJK JP') -> str:
    """字幕/コメントから ASS を組み立てて返す。イベントが1つも無ければ空文字。

    start/end は切り出し区間(動画先頭からの秒)。この区間へ平行移動し、外は落とす。
    """
    cap_px = max(18, int(height * 0.045))
    dm_px = max(14, int(height * 0.035))
    head = [
        '[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 2',
        f'PlayResX: {width}', f'PlayResY: {height}', 'ScaledBorderAndShadow: yes', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, '
        'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, '
        'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        f'Style: cap,{font},{cap_px},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,'
        f'0,0,0,0,100,100,0,0,1,{max(2, cap_px // 12)},0,2,20,20,{int(height * 0.04)},1',
        f'Style: dm,{font},{dm_px},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,'
        f'1,0,0,0,100,100,0,0,1,{max(2, dm_px // 10)},0,7,0,0,0,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ]

    events = []
    for s in caption_screens(captions or []):
        events.append(f"Dialogue: 1,{_ass_time(s['start'])},{_ass_time(s['end'])},cap,,0,0,0,,"
                      f"{_esc(s['text'])}")
    events += comment_events(comments or [], width, height, dm_px)

    # 切り出し区間へ平行移動し、範囲外を落とす
    shifted = []
    for line in events:
        m = re.match(r'^Dialogue: (\d+),([^,]+),([^,]+),(.*)$', line)
        if not m:
            continue
        layer, st, en, rest = m.groups()
        st_s, en_s = _parse_time(st) - start, _parse_time(en) - start
        if end is not None and st_s > (end - start):
            continue
        if en_s <= 0:
            continue
        shifted.append(f'Dialogue: {layer},{_ass_time(max(0.0, st_s))},'
                       f'{_ass_time(max(0.01, en_s))},{rest}')
    if not shifted:
        return ''
    return '\n'.join(head + shifted) + '\n'


def _parse_time(t: str) -> float:
    h, m, s = str(t).split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)
