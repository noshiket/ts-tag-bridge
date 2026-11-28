"""チャプター（チャプターファイルを読む・トリムから作る・Amatsukaze の名前）"""

import re


_CHAPTER_LINE_RE = re.compile(r'^CHAPTER(\d+)(NAME)?=(.*)$')


# JLS が付けた区分の呼び名（分割の画面の区分の呼び名と対）
_CHAPTER_LABELS = {'L': '本編', 'Mix': '本編', 'CM': 'CM', 'Nologo': 'ロゴなし',
                   'Trailer(add)': '予告', 'Sponsor(add)': '提供'}


def _label_at(segs, at) -> str:
    """その位置に重なる JLS 区間の呼び名。"""
    for seg_s, seg_e, lab in segs:
        if seg_s <= at < seg_e:
            return _CHAPTER_LABELS.get(lab, lab or '本編')
    return '本編'


def _chapter_hms(sec: float) -> str:
    """chapter.txt の時刻表記（00:01:51.979）。"""
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int(sec // 60) % 60
    return f'{h:02d}:{m:02d}:{sec - h * 3600 - m * 60:06.3f}'


def _parse_chapter_txt(txt: str) -> list:
    """chapter.txt を [(秒, 名前)] にする（OGM 形式）。"""
    times, names = {}, {}
    for line in (txt or '').splitlines():
        m = _CHAPTER_LINE_RE.match(line.strip())
        if not m:
            continue
        if m[2]:
            names[m[1]] = m[3]
        else:
            t = re.match(r'^(\d+):(\d+):(\d+(?:\.\d+)?)$', m[3])
            if t:
                times[m[1]] = int(t[1]) * 3600 + int(t[2]) * 60 + float(t[3])
    return [(times[k], names.get(k, '')) for k in sorted(times, key=int)]


def _trim_keeps(trim_spec, fallback_end) -> list:
    """採用区間を base 範囲へクランプして [(開始秒, 終了秒, チャプター名)] にする。

    _trim_avs_line と同じクランプ。EOF までの採用区間(to=None)は fallback_end で閉じる。
    """
    base_start, base_end, spec_keeps = trim_spec
    keeps = []
    for s, e, name in spec_keeps:
        s = max(s, base_start)
        if base_end is not None:
            s = min(s, base_end)
            e = base_end if e is None else min(e, base_end)
        if e is None:
            e = fallback_end
        if e is None or e <= s:
            continue
        keeps.append((s, e, name))
    return keeps


# Amatsukaze が付けるチャプター名(A / A90Sec …)の規則。
# JLS の出力(jls0.txt)と Amatsukaze の chapter.txt を突き合わせて求めた
# （golden 1本 + 実データ7組で完全一致）:
#   ・印は「残す区間の頭」と「区間の中の JLS の切れ目」に置く
#   ・文字は残す区間の番号（1つ目=A, 2つ目=B …）
#   ・接尾 'NNSec' は (add)系(提供/予告/エンドカード)か、30〜90秒の定尺(30の倍数)
#     （実測: 60秒・90秒には付き、4/5/15/50/56/422/528/536/600秒には付かない）
#   ・区間の端に 1秒未満だけ残る切れ端では印を作らない
_AMZ_HEAD_EPS = 0.6


_AMZ_SLIVER_SEC = 1.0


_AMZ_SEC_STEP = 30      # 定尺(OP/ED/CM枠)とみなす刻み。この倍数なら 'NNSec' が付く


_AMZ_SEC_MAX = 90       # 定尺の上限。600秒(30の倍数)には付かないので頭を打つ


def amz_chapter_names(trims, segs) -> list:
    """Amatsukaze の chapter.txt を再現する [(元の時間, 名前, ラベル)] を返す。

    trims: [(開始秒, 終了秒)]（残す区間）
    segs : [(開始秒, 終了秒, ラベル)]（JLS の区間。時間順）
    """
    out = []
    for ti, (t0, t1) in enumerate(trims):
        letter = chr(ord('A') + min(ti, 25))

        def _name(seg):
            d = round(seg[1] - seg[0])
            fixed = _AMZ_SEC_STEP <= d <= _AMZ_SEC_MAX and d % _AMZ_SEC_STEP == 0
            return (f'{letter}{d}Sec'
                    if (str(seg[2]).endswith('(add)') or fixed) else letter)

        head = next((c for c in segs if c[1] > t0 + _AMZ_HEAD_EPS), None)
        if head and head[0] < t1:
            out.append((t0, _name(head), head[2]))
        for c in segs:
            if t0 + _AMZ_HEAD_EPS < c[0] < t1 - _AMZ_SLIVER_SEC:
                out.append((c[0], _name(c), c[2]))
    return sorted(out)


def chapters_from_trim(trim_spec, jls_segments, chapter_names=None) -> list:
    """この話のチャプターを採用区間と CM解析(JLS)から導出する。

    戻り値は出力の時間軸で
    [{'start','end','src','src_end','name','label','keep_index'}]
    （'src'/'src_end' は元(カット前)の時間。分割画面はこちらで並べる）。
    A(0.000〜XX) + A90Sec(XX〜YY) + … のように、1つの採用区間の中にも
    区切り(OP・アイキャッチ等)があれば複数入る。

    Amatsukaze の chapter.txt をそのまま使わないのは、あれが Amatsukaze 自身の
    CM判定に基づくものだから。分割画面で採用区間を手で直すと食い違う。
    名前の付け方は amz_chapter_names（Amatsukaze の規則を再現したもの）に従う。
    採用区間に名前を付けていれば、その区間の先頭のチャプターだけその名前にする。
    chapter_names([(元の時間, 名前)]) を渡すと、その位置のチャプターの名前を差し替える
    （分割画面でチャプター1つずつに付けた名前。segments の chap(...) から来る）。
    """
    segs = []
    for x in (jls_segments or []):
        if x.get('start') is None or x.get('end') is None:
            continue
        segs.append((float(x['start']), float(x['end']), x.get('label') or ''))
    segs.sort()
    if not segs:
        return []

    keeps = _trim_keeps(trim_spec, segs[-1][1])
    if not keeps:
        return []

    src_marks = amz_chapter_names([(s, e) for s, e, _n in keeps], segs)

    # 出力の時間軸へ写す（採用区間を順に詰めた位置）
    spans, acc = [], 0.0
    for s, e, name in keeps:
        spans.append((s, e, acc, name))
        acc += e - s
    total = acc

    out = []
    for at, name, lab in src_marks:
        for ki, (src_s, src_e, out_s, keep_name) in enumerate(spans):
            if src_s - _AMZ_HEAD_EPS <= at < src_e:
                if keep_name and abs(at - src_s) < 0.5:
                    name = keep_name          # 手で付けた名前は区間の先頭だけ
                out.append({'start': round(out_s + max(0.0, at - src_s), 3),
                            'src': round(at, 3),
                            'name': name, 'label': lab, 'keep_index': ki})
                break
    # チャプター1つずつに付けた名前で上書きする
    for at, nm in (chapter_names or []):
        if not nm:
            continue
        hit = min(out, key=lambda c: abs(c['src'] - at), default=None)
        if hit is not None and abs(hit['src'] - at) < 0.5:
            hit['name'] = nm
    out.sort(key=lambda c: c['start'])
    keep_end = {i: round(sp[1], 3) for i, sp in enumerate(spans)}
    for i, c in enumerate(out):
        nxt = out[i + 1] if i + 1 < len(out) else None
        c['end'] = round(nxt['start'] if nxt else total, 3)
        # 元の時間での終わり。同じ採用区間の次の印まで、無ければその区間の終わり
        c['src_end'] = (round(nxt['src'], 3)
                        if nxt and nxt['keep_index'] == c['keep_index']
                        else keep_end[c['keep_index']])
    return out


def chapter_txt_from_trim(trim_spec, jls_segments, base_txt: str = '',
                          chapter_names=None) -> str:
    """chapters_from_trim の結果を chapter.txt(OGM形式)にする。

    CM解析が無ければ '' を返す（呼び出し側は Amatsukaze の chapter.txt を使う）。
    """
    chapters = chapters_from_trim(trim_spec, jls_segments, chapter_names)
    if not chapters:
        return ''
    lines = []
    for i, c in enumerate(chapters, 1):
        lines.append(f'CHAPTER{i:02d}={_chapter_hms(c["start"])}')
        lines.append(f'CHAPTER{i:02d}NAME={c["name"]}')
    return '\n'.join(lines) + '\n'
