"""共通区間から時刻を付け替える（字幕・コメント）"""

from logic import audio_overlap


# ---------------------------------------------------------------------------
# 時刻の付け替え
# ---------------------------------------------------------------------------

def match_ranges(matches) -> list:
    """matches を refine と同じ形の区間 dict にする（音声比較だけで取り込む時用）。

    ずれは測り直していないので coarse_offset は offset と同じ値を入れる。
    tag.json の記録・画面表示が frame_sync.refine の結果と同じ形で扱える。
    """
    out = []
    for m in matches or []:
        try:
            a0 = audio_overlap.parse_time(m['videoA']['start'])
            a1 = audio_overlap.parse_time(m['videoA']['end'])
            b0 = audio_overlap.parse_time(m['videoB']['start'])
            b1 = audio_overlap.parse_time(m['videoB']['end'])
        except (KeyError, TypeError, ValueError):
            continue
        if b1 <= b0:
            continue
        out.append({'a_start': a0, 'a_end': a1, 'b_start': b0, 'b_end': b1,
                    'offset': a0 - b0, 'coarse_offset': a0 - b0})
    return sorted(out, key=lambda r: r['a_start'])


def build_ranges(matches) -> list:
    """matches を (b_start, b_end, offset) のリストにする。

    offset は「取り込み元(B)の秒 → この動画(A)の秒」への加算値。
    """
    out = []
    for m in matches or []:
        try:
            a0 = audio_overlap.parse_time(m['videoA']['start'])
            b0 = audio_overlap.parse_time(m['videoB']['start'])
            b1 = audio_overlap.parse_time(m['videoB']['end'])
        except (KeyError, TypeError, ValueError):
            continue
        if b1 > b0:
            out.append((b0, b1, a0 - b0))
    return bridge_ranges(sorted(out))


# 隣り合う区間のずれが同じ時に、間の穴を埋める許容幅。
# 音声一致は 500ms フレームの特徴量が min_match 秒ぶん続くことが条件なので、
# アラーム音・ピー音・局ごとの音声処理といった「絵は同じだが音が少し違う」区間で
# 一致が切れ、そこが穴として落ちる。両側のずれがほぼ同じなら間も同じ時間軸なので、
# 落とさず埋める（実測: ずれが全区間 +0ms なのに13個へ分断され、全体の27%が穴・
# コメントの40%が取り込まれていなかった）。
# CM の差し替えのように内容そのものが違う穴は、両側でずれが変わるので埋まらない。
#
# 上限と許容幅は、ある局の動画へ別の局の録画の字幕を入れた実測で決めた。
# 同じ話数の別局録画で、どちらも CM を切った後の尺は 1449.9秒とほぼ同じ。それでも
# 一致は10本に分断され、340件のうち264件しか入らなかった。残った穴は2種類:
#   653.6→920.2 (266.6秒) … 両側のずれは -92ms と -162ms。差は 70ms しかないのに
#     許容幅 50ms を超えて弾かれていた。1450秒に対する 70ms はチューナー間の
#     時計のずれで、内容の違いではない（内容が違えば穴の先でずれが秒単位で変わる）。
#   1294.7→1347.7 … 間に「ずれ +1.5秒」の10秒だけの区間が挟まっていた（下記）。
# 許容幅を 0.3秒まで広げ、上限を 300秒にして 340件すべて入るようにした。
# 許容幅を広げても字幕がずれないのは、下の実装が**それぞれのずれを保ったまま**
# 穴の中間で受け持ちを切り替えるため（継ぎ目で最大でも差のぶんしか動かない）。
# 上限を外さないのは、CM を切っていない録画どうしだと「長さは同じで中身が違う」
# CM の塊を橋渡ししてしまい、相手局の CM の字幕が入るため。
_BRIDGE_MAX_SEC = 300.0
_BRIDGE_OFFSET_TOL = 0.3    # ずれが同じとみなす幅(300ms)
_BRIDGE_SAME_OFFSET = 0.001  # これ以下の差なら1区間にまとめる(1ms)


def drop_offset_outliers(ranges, tol=_BRIDGE_OFFSET_TOL) -> list:
    """両隣と食い違い、両隣どうしは一致している区間を捨てる。

    音声一致はときどき、短い区間に的外れなずれを付ける（実測: ある動画で
    1322.0〜1332.0 の10秒だけ「ずれ +1.5秒」。両隣は -162ms で揃っており、
    その区間だけ video_judged=false、細かい判定も0件だった）。
    内容が本当に違うなら、ずれはその先ずっと変わる。すぐ元に戻るなら一致の誤りで、
    しかもこれが挟まっていると両隣が繋がらず、前後あわせて43秒ぶんの穴になる。
    """
    rs = [tuple(r) for r in ranges]
    return [r for i, r in enumerate(rs)
            if not (0 < i < len(rs) - 1
                    and abs(rs[i - 1][2] - rs[i + 1][2]) <= tol
                    and abs(r[2] - rs[i - 1][2]) > tol
                    and abs(r[2] - rs[i + 1][2]) > tol)]


def bridge_ranges(ranges) -> list:
    """ずれがほぼ同じ隣り合う区間の間の穴を埋める。

    ずれが完全に同じなら1区間にまとめ、わずかに違う場合は**それぞれのずれを保ったまま**
    穴の中間まで両側を伸ばして閉じる。まとめて片側のずれを全体に使うと、
    もう一方の区間が最大で許容幅ぶんずれる（字幕はこのずれが効く）。
    """
    out = []
    ranges = drop_offset_outliers(ranges)
    for r in ranges:
        r = tuple(r)
        if out:
            pb0, pb1, poff = out[-1]
            gap = r[0] - pb1              # 負なら重なり
            if gap <= _BRIDGE_MAX_SEC and abs(r[2] - poff) <= _BRIDGE_OFFSET_TOL:
                if abs(r[2] - poff) <= _BRIDGE_SAME_OFFSET:
                    out[-1] = (pb0, max(pb1, r[1]), poff)     # 同じずれ＝1区間に
                    continue
                if gap > 0:
                    mid = pb1 + gap / 2                       # 穴を半分ずつ受け持つ
                    out[-1] = (pb0, mid, poff)
                    r = (mid, r[1], r[2])
        out.append(r)
    return out


# 共通区間の外側（先頭より前・末尾より後）でも、この秒数までは端の区間の
# ずれをそのまま延長して付け替える。
# 音声一致の検出は 500ms フレーム × min_match 秒(既定10秒)の連続一致が条件なので、
# 実際には内容が同じでも先頭・末尾の十数秒は区間に入らない（実測: 24分の同一番組で
# 検出区間が 9.5秒〜1421秒＝冒頭9.5秒・末尾19秒が範囲外）。そのまま落とすと
# 冒頭の字幕/コメントが取り込まれないため、端だけは外挿する。
_EDGE_EXTRAPOLATE_SEC = 30.0


def remap(t, ranges, duration=None):
    """取り込み元の秒 t を、この動画の秒へ変換する。対応先が無ければ None。

    duration: 取り込み先の尺(秒)。端の外挿が動画の外へ出るのを防ぐ。
    """
    for b0, b1, off in ranges:
        if b0 <= t <= b1:
            return t + off
    # 端の外挿（_EDGE_EXTRAPOLATE_SEC まで）
    first, last = ranges[0], ranges[-1]
    if t < first[0] and first[0] - t <= _EDGE_EXTRAPOLATE_SEC:
        off = first[2]
    elif t > last[1] and t - last[1] <= _EDGE_EXTRAPOLATE_SEC:
        off = last[2]
    else:
        return None
    v = t + off
    # 取り込み先の尺に収まらない＝向こうに対応する内容が無いので落とす
    if v < 0 or (duration is not None and v > duration):
        return None
    return v
