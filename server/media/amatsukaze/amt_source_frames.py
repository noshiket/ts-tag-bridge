"""AMTSource のコマの大きさ合わせ（主な大きさ・合わせ方・最初の PTS）とフィールドの合成"""

from typing import Tuple
import numpy as np


def _plane_y(frame) -> np.ndarray:
    """AVFrame の Y 平面を stride を潰さずに view で取り出す。"""
    p = frame.planes[0]
    h, w = frame.height, frame.width
    if frame.format.name.endswith(('p10le', 'p10')):
        buf = np.frombuffer(p, np.uint16)
        return buf.reshape(-1, p.line_size // 2)[:h, :w]
    buf = np.frombuffer(p, np.uint8)
    return buf.reshape(-1, p.line_size)[:h, :w]


def _merge_field(top: np.ndarray, bottom: np.ndarray) -> np.ndarray:
    """偶数ラインを top から、奇数ラインを bottom から取った絵を作る。

    原典: Amatsukaze/AMTSource.h:125-134 Copy1（MergeField から呼ばれる）
          同 AMTSource.cpp:451-460 halfDelay のとき top=直前ピクチャ, bottom=現在

    3:2プルダウンの BFF / BFF_RFF はフィールドが半フレームずれて並ぶので、
    Amatsukaze はこう合成した絵を n 番のフレームとして返す。
    """
    out = np.empty_like(bottom)
    out[0::2] = top[0::2]
    out[1::2] = bottom[1::2]
    return out


# 解像度を調べるときに見るフレーム数（全体に散らす）
_SIZE_SAMPLES = 8


# 1標本あたり、フレームが出るまで読み飛ばすパケットの上限
_SIZE_MAX_PACKETS = 200


class _AMTFramesMixin:
    """AMTSource のコマの大きさ合わせ（主な大きさ・合わせ方・最初の PTS）とフィールドの合成"""

    def _dominant_size(self, w0: int, h0: int) -> Tuple[int, int]:
        """中身で最も多い解像度を返す。判らなければコンテナの申告のまま。

        配信の取り込みは途中で画質が変わることがある（実測:
        先頭151フレームが 1280x720、以降ずっと 854x480）。コンテナの申告は
        先頭の値なので、鵜呑みにすると読む側と食い違う。

        chapterexe_py はこの幅・高さを numba の njit へそのまま渡す。njit は
        範囲を見ないので、854x480 のバッファを 1280x720 として読んで SIGSEGV で
        落ちていた（実測: 10時間の録画で解析が丸ごと失敗し、無音区間もシーンも
        CM除去位置も出ず、分割できなくなった）。
        """
        if self._dom_size is not None:
            return self._dom_size
        self._dom_size = (w0, h0)
        try:
            import collections
            c = self._av.open(self.path)
            try:
                st = next(s for s in c.streams
                          if s.type == 'video' and s.id == self.stream.id)
                # TS の pts は 0 から始まらない。start_time を足さないと
                # 毎回先頭へ戻ってしまい、先頭の解像度しか見えない
                base = st.start_time or 0
                span = st.duration or 0
                seen = collections.Counter()
                for i in range(_SIZE_SAMPLES):
                    try:
                        if span > 0:
                            c.seek(int(base + span * (i + 0.5) / _SIZE_SAMPLES),
                                   stream=st)
                    except Exception:
                        continue
                    # 取り込みの TS は継ぎ目が不整合で、シーク直後のパケットが
                    # 壊れていることがある。decode() をそのまま回すと最初の1個で
                    # 例外になって標本が取れないので、壊れたぶんは読み飛ばす
                    # （実測: そのままだと8標本すべて失敗し、先頭の
                    #   1280x720 のまま 854x480 の本編を拡大していた）
                    tried = 0
                    for pkt in c.demux(st):
                        tried += 1
                        if tried > _SIZE_MAX_PACKETS:
                            break
                        try:
                            got = next(iter(pkt.decode()), None)
                        except Exception:
                            continue
                        if got is not None:
                            seen[(got.width, got.height)] += 1
                            break
                    if span <= 0:
                        break
                if seen:
                    self._dom_size = seen.most_common(1)[0][0]
            finally:
                c.close()
        except Exception:
            pass
        return self._dom_size

    def _fit(self, frame, vi):
        """申告と違う大きさのフレームを揃える。

        読む側は GetVideoInfo の幅・高さでバッファを読む。食い違ったまま渡すと
        範囲外を読んで落ちる（_dominant_size の説明を参照）。
        """
        if frame.width == vi.width and frame.height == vi.height:
            return frame
        return frame.reformat(width=vi.width, height=vi.height,
                              format=frame.format.name)

    def _first_pts(self) -> int:
        """先頭フレームの pts。seek 後のフレーム番号算出に要る。"""
        if self._first_pts_cache is None:
            c = self._av.open(self.path)
            try:
                st = next(s for s in c.streams if s.type == 'video' and s.id == self.stream.id)
                for frame in c.decode(st):
                    self._first_pts_cache = frame.pts
                    break
            finally:
                c.close()
        return self._first_pts_cache
