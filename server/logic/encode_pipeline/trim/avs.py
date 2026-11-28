"""区間・チャプターの読み取りと trim.avs の書き出し"""

import json
import re
from ..segments import _parse_hms


# ---------------------------------------------------------------------------
# trimモード: 分割画面の trim(除去区間) 指定を Amatsukaze の {SrcPath}.trim.avs に
# 変換して CM カットさせる（物理分割なし）。
#   split_ts: cut.ts をソースTSへのリンクにする（run_split_ts 内。実体は持たない）
#   encoding: CMCheck 投入→完了→amts0.dat のフレームPTSで trim.avs 書き込み→Batch 投入
# ---------------------------------------------------------------------------

# enriched 形式 keepN(...) / trimN(...) も拾う（keepN.TOT / keepN.pts はドットが入るため一致しない）
_TRIM_TOKEN_RE = re.compile(r'^(keep|trim)\d*\(([^-@)]+)-([^-@)]+)(?:@([^)]*))?\)$')
# chap(元の時間@名前) … チャプター1つずつの名前。位置は元(カット前)の時間軸
_CHAP_TOKEN_RE = re.compile(r'^chap\d*\(([^@)]+)@([^)]*)\)$')


def parse_chapter_names(segments_raw) -> list:
    """segments から chap(...) を取り出して [(元の時間, 名前)] を返す。"""
    if not segments_raw:
        return []
    seg = segments_raw
    try:
        parsed = json.loads(segments_raw)
        if isinstance(parsed, str):
            seg = parsed
    except Exception:
        pass
    if not isinstance(seg, str):
        return []
    out = []
    for p in seg.split(',')[1:]:
        m = _CHAP_TOKEN_RE.match(p.strip())
        if not m:
            continue
        try:
            out.append((_parse_hms(m[1]), (m[2] or '').strip()))
        except ValueError:
            continue
    return sorted(out)
_PTS_CYCLE = 1 << 33  # MPEG-TS PTS は 33bit で周回する


def _complement(base_start, base_end, removes):
    """base 範囲から除去区間を引いた採用区間を返す（旧 trim(...) 形式の変換用）。

    採用区間は (開始, 終了, チャプター名)。旧形式に名前は無いので '' を入れる。
    """
    keeps = []
    cursor = base_start
    for f, t, _name in sorted(removes):
        if base_end is not None:
            f = min(f, base_end)
            t = min(t, base_end)
        if cursor < f:
            keeps.append((cursor, f, ''))
        cursor = max(cursor, t)
    if base_end is None:
        keeps.append((cursor, None, ''))
    elif cursor < base_end:
        keeps.append((cursor, base_end, ''))
    return keeps


def _parse_trim_mode_segments(segments_raw):
    """encodings.segments から trimモード指定を取り出し、**採用区間**へ正規化して返す。

    keep(...) トークン（採用区間・現行形式）または trim(...) トークン
    （除去区間・旧形式）が1つ以上あれば
    (base_start_sec, base_end_sec | None, [(from_sec, to_sec, chapter_name), ...]) を返す。
    3要素目は常に採用区間で、旧形式のときだけここで補集合を取る。
    末尾が EOF までの採用区間は to=None になる。
    無ければ None（従来の物理分割経路）。base='full' は全範囲（base_end=None）。
    """
    if not segments_raw:
        return None
    seg = segments_raw
    try:
        parsed = json.loads(segments_raw)
        if isinstance(parsed, str):
            seg = parsed
    except Exception:
        pass
    if not isinstance(seg, str):
        return None
    parts = seg.split(',')
    keeps, removes = [], []
    for p in parts[1:]:
        m = _TRIM_TOKEN_RE.match(p.strip())
        if not m:
            continue
        try:
            rng = (_parse_hms(m[2]), _parse_hms(m[3]), (m[4] or '').strip())
        except ValueError:
            continue
        (keeps if m[1] == 'keep' else removes).append(rng)
    if not keeps and not removes:
        return None
    base = parts[0]
    if base == 'full':
        start, end = 0.0, None
    else:
        try:
            start = max(0.0, _parse_hms(base[:12]))
            end = _parse_hms(base[13:])
        except ValueError:
            return None
        if end <= start:
            end = None  # 不正な base 終端は全範囲扱い（split と同じくEOFまで）
    if keeps:
        # 現行形式。keep と trim が混在していたら keep を正とする（旧形式は無視）
        return (start, end, sorted(keeps))
    return (start, end, _complement(start, end, removes))


def trim_frame_ranges(pts_list: list, first_pts: int, trim_spec) -> list:
    """採用区間(秒)をフレーム番号の [(開始, 終了)] へ変換する。終了は End-inclusive。

    trim_spec の採用区間は _parse_trim_mode_segments が正規化済み（旧 trim(...) 形式の
    補集合変換もそちらで済ませている）。ここでは base 範囲へクランプするだけ。
    時刻→フレームは frame_index.time_to_frame（UIのフレーム番号表示と同一ロジック）。
    Amatsukaze の Trim(a,b) も QSVEncC の --trim a:b も End-inclusive なので、
    keep [s,e) → (frame(s), frame(e)-1)。両方の経路で同じ区間になるよう共有する。
    """
    from media.frame_index.lookup import time_to_frame

    n = len(pts_list)
    base_start, base_end, spec_keeps = trim_spec

    def frame_of(t_sec: float) -> int:
        return time_to_frame(pts_list, first_pts, t_sec)

    keeps = []
    for s, e, _name in spec_keeps:
        s = max(s, base_start)
        if base_end is not None:
            s = min(s, base_end)
            e = base_end if e is None else min(e, base_end)
        if e is not None and e <= s:
            continue
        keeps.append((s, e))

    ranges = []
    for s, e in keeps:
        a = frame_of(s)
        b = (n if e is None else frame_of(e)) - 1  # End-inclusive
        a = max(0, min(a, n - 1))
        b = min(b, n - 1)
        if b < a:
            continue
        ranges.append((a, b))
    if not ranges:
        raise RuntimeError('trim変換の結果 keep 区間が空になりました')
    return ranges


def _trim_avs_line(pts_list: list, first_pts: int, trim_spec) -> str:
    """採用区間を Amatsukaze の trim.avs の1行にする。"""
    return ' ++ '.join(f'Trim({a},{b})'
                       for a, b in trim_frame_ranges(pts_list, first_pts, trim_spec))


def _write_trim_avs_file(input_ts_app: str, first_pts: int, trim_spec, pts_list: list) -> str:
    """フレーム表(pts_list)から {SrcPath}.trim.avs を書き、書いた avs 行を返す。

    Amatsukaze は {SrcPath}.trim.avs があると --trimavs で trim 判定を完全置換する。
    """
    avs_line = _trim_avs_line(pts_list, first_pts, trim_spec)
    trim_avs_app = input_ts_app + '.trim.avs'
    with open(trim_avs_app, 'w', encoding='utf-8') as f:
        f.write(avs_line + '\n')
    return avs_line
