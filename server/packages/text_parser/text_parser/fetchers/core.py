"""ShoboiInfoFetcher の本体。メソッドは機能ごとに mixin へ分けてある。"""

from .episodes import _EpisodesMixin
from .by_sid import _BySidMixin
from .by_title import _ByTitleMixin


class ShoboiInfoFetcher(_EpisodesMixin, _BySidMixin, _ByTitleMixin):
    """
    しょぼいカレンダー API を利用して番組・話数情報を取得するクラス

    CompleteProgramFinder を内部に保持し、SID・放送日時・タイトルから
    話数やエピソード名などの情報を取得する。

    Attributes:
        finder: CompleteProgramFinder のインスタンス（API クライアント）
    """

    def __init__(self):
        from ..shoboi_api import CompleteProgramFinder
        self.finder = CompleteProgramFinder()
