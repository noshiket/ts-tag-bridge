"""PTS の差（一周を考えた符号付きの差・頭の PTS を見る幅）"""

from .codec import _CLOCK, _PTS_CYCLE


# first_pts 候補として妥当とみなす範囲（最初に見つけたPESからの差）。
# データ放送PES等に PTS=5 のような異常値が混じることがあり、33bitラップ跨ぎと
# 誤判定されて最小値に選ばれるため、この窓の外は候補から除外する。
_HEAD_PTS_WINDOW = 10 * _CLOCK


def signed_pts_diff(a: int, b: int) -> int:
    """PTS a - b（33bitラップを符号付き差分で吸収）。"""
    d = (a - b) % _PTS_CYCLE
    if d > _PTS_CYCLE // 2:
        d -= _PTS_CYCLE
    return d
