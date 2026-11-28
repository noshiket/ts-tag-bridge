"""映像フレームの順次デコード。

CM 解析の logoframe_py / chapterexe_py（thirdparty/、別リポジトリ）は単体で動くよう、これと frame_index の
一部の写しを持っている（各リポジトリの amt_source.py・frame_table.py）。ここを直したらそちらも合わせること。

原典: Amatsukaze の AMTSource（AviSynth プラグイン）に相当する位置づけ。
Amatsukaze は amts0.dat を経由するが、こちらは PyAV で直接デコードする。

Y 平面はゼロコピーで取り出す。frame.to_ndarray(format='gray') は swscale が
毎フレーム走って 1920x1080 のコピーが発生するので使わない。
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

from .amt_source_frames import _AMTFramesMixin
from .amt_source_read import _AMTReadMixin


_CLOCK = 90000        # PTS の単位(90kHz)


@dataclass
class VideoInfo:
    """原典: Amatsukaze の VideoInfo 相当（必要な項目だけ）"""

    width: int
    height: int
    fps_num: int
    fps_den: int
    bits: int = 8

    @property
    def fps(self) -> float:
        return self.fps_num / self.fps_den

    @property
    def maxv(self) -> int:
        return (1 << self.bits) - 1


class AMTSource(_AMTFramesMixin, _AMTReadMixin):
    """映像を先頭から順にデコードして Y 平面を返す。

    使い方:
        with AMTSource(path) as src:
            vi = src.GetVideoInfo()
            for n, Y in src.iterate():
                ...
    """

    # seek 後は壊れたフレームを評価しないよう、この枚数だけ手前から復号して捨てる
    SEEK_MARGIN_FRAMES = 30

    def __init__(self, path: str, video_pid: Optional[int] = None,
                 frame_pts: Optional[List[int]] = None,
                 half_delay: Optional[List[bool]] = None,
                 decode_threads: Optional[int] = None):
        """frame_pts / half_delay: media.frame_index.build_frame_table の結果。

        frame_pts を渡すとフレーム番号をこの表の**位置**で決める。渡さない場合は
        pts と fps から計算するが、それが正しいのは 1 フレーム = 一定間隔の
        素材だけ。3:2プルダウン(テレシネ)では PTS 差分が 3003/4504/4505 と
        揺れ、同じ PTS が 2 エントリになる（RFF）ため計算では合わない。
        実測: プルダウンのアニメ1本で 53,935 中 51,905 フレームが 1 ずれた。
        Amatsukaze の Trim(n) はこの表の位置なので、必ず渡すこと。

        decode_threads=1 にするとデコーダをシングルスレッドにする。プロセスを
        並べて走らせるときはこちらが速い（原典も「4並列 x デコード1スレッド」と
        「1並列 x デコード4スレッド」を出し分けている）。既定は AUTO。

        half_delay を渡すと True のフレームを合成して返す（_merge_field 参照）。
        渡さないとそのピクチャをそのまま返すが、実測でその2フレームが
        chapter_exe の SCPos を 1 ずらした（jls0.txt の区切りにそのまま出る）。
        """
        import av  # 遅延 import（このモジュールを import するだけでは av を要求しない）

        self._av = av
        self.path = path
        self._frame_pts = list(frame_pts) if frame_pts is not None else None
        # 1つも立っていなければ持たない。持つと合成用に毎フレーム直前の絵を
        # 複製することになり、プルダウンでない素材で丸損する（実測 +164秒）
        self._half = list(half_delay) if half_delay and any(half_delay) else None
        self.container = av.open(path)
        streams = [s for s in self.container.streams if s.type == 'video']
        if not streams:
            raise ValueError(f'{path}: 映像ストリームがありません')
        # 多プログラム TS 対応（PyAV の Stream.id は MPEG-TS の PID）
        self.stream = next((s for s in streams if s.id == video_pid), streams[0]) \
            if video_pid is not None else streams[0]
        self._decode_threads = decode_threads
        self._setup_threads()
        self._first_pts_cache: Optional[int] = None
        self._dom_size: Optional[Tuple[int, int]] = None
        self._used = False          # 一度でも iterate したか（巻き戻し判定用）
        self.decode_errors = 0      # 壊れていて飛ばしたパケットの数

    def _setup_threads(self) -> None:
        if self._decode_threads == 1:
            self.stream.thread_type = 'NONE'
            self.stream.codec_context.thread_count = 1
        else:
            self.stream.thread_type = 'AUTO'
            self.stream.codec_context.thread_count = self._decode_threads or 0

    def __enter__(self) -> 'AMTSource':
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        try:
            self.container.close()
        except Exception:
            pass

    def GetVideoInfo(self) -> VideoInfo:
        cc = self.stream.codec_context
        rate = self.stream.average_rate or self.stream.guessed_rate
        num, den = rate.numerator, rate.denominator
        # frame_pts があればそれが正。コンテナの申告は当てにならない
        # （実測: 中身 23.978fps の配信録画で average_rate が 30/1 と出た。
        # このfpsは音声とフレーム番号の対応に使うので、ずれると無音位置が
        # そのぶん狂う）。表は実際のフレームそのものなので取り違えようがない
        f = self._frame_pts
        if f and len(f) > 1 and f[-1] > f[0]:
            eff = (len(f) - 1) * _CLOCK / float(f[-1] - f[0])
            if abs(eff - num / den) > 0.05:
                num, den = int(round(eff * 1001)), 1001
        fmt = (cc.format.name if cc.format else 'yuv420p')
        bits = 10 if '10' in fmt else 8
        w, h = self._dominant_size(cc.width, cc.height)
        return VideoInfo(width=w, height=h,
                         fps_num=num, fps_den=den, bits=bits)


# ---------------------------------------------------------------------------
# amts0.dat 経由の音声（golden 検証用）
# ---------------------------------------------------------------------------


