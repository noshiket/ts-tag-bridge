"""AMTSource のコマの読み出し（順に読む・壊れたコマを飛ばす・シーク・開き直し）"""

import bisect
from typing import Iterator, Optional, Tuple
import numpy as np
from .amt_source_frames import _merge_field, _plane_y


class _AMTReadMixin:
    """AMTSource のコマの読み出し（順に読む・壊れたコマを飛ばす・シーク・開き直し）"""

    def iterate(self, first: int = 0, last: Optional[int] = None
                ) -> Iterator[Tuple[int, np.ndarray]]:
        """[first, last] のフレームを順に (フレーム番号, Y平面) で返す。

        フレーム番号は pts から求める。デコード順と表示順が違う(Bフレーム)ため、
        「デコードした枚数」を番号にすると seek 後にずれる。PyAV の decode() は
        表示順で返すので、pts さえ見れば絶対フレーム番号が決まる。

        frame_pts を渡してあれば、その表を pts で二分探索した**位置**が番号になる
        （Amatsukaze の Trim(n) と同じ番号系）。3:2プルダウンでは同じ pts が
        表に2回入るので、1枚のデコード結果を2エントリぶん返す。
        表に無い pts（最初のGOPより前のBフレーム、デコード順最後のピクチャ）は
        frame_index と同じ規則で捨てられる。

        Y はデコーダ内部バッファの view なので、保持したい場合は呼び出し側で copy する。
        """
        vi = self.GetVideoInfo()
        tb = float(self.stream.time_base)
        spf = vi.fps_den / vi.fps_num          # 1 フレームあたりの秒
        fpts = self._frame_pts

        back = self.SEEK_MARGIN_FRAMES
        while True:
            target = self._seek(first, back, fpts, tb, spf)
            base_pts = (fpts[0] if fpts is not None
                        else (self._first_pts() if target > 0 else None))
            self._used = True

            prev_Y = None       # halfDelay 合成用の直前ピクチャ
            overshot = False    # seek が first より後ろに着いた
            checked = False
            for frame in self._decode_tolerant():
                if frame.pts is None:
                    continue
                if base_pts is None:
                    base_pts = frame.pts
                    self._first_pts_cache = frame.pts
                if fpts is not None:
                    lo = bisect.bisect_left(fpts, frame.pts)
                    hi = bisect.bisect_right(fpts, frame.pts)
                    if lo >= hi:
                        continue        # 表に無いピクチャ（frame_index の除外規則）
                    if not checked:
                        checked = True
                        if lo > first and target > 0:
                            overshot = True
                            break
                    if last is not None and lo > last:
                        break
                    Y = _plane_y(self._fit(frame, vi))
                    for n in range(lo, hi):
                        if first <= n and (last is None or n <= last):
                            if self._half is not None and self._half[n]:
                                if prev_Y is None:
                                    continue    # 直前が無いと作れない（原典も同じ）
                                yield n, _merge_field(prev_Y, Y)
                            else:
                                yield n, Y
                        elif last is not None and n > last:
                            break
                    # 複製は次のエントリが合成を要るときだけ（hi は次のピクチャの先頭）
                    prev_Y = (Y.copy() if self._half is not None
                              and hi < len(self._half) and self._half[hi] else None)
                    continue
                n = int(round((frame.pts - base_pts) * tb / spf))
                if n < first:
                    continue
                if last is not None and n > last:
                    break
                yield n, _plane_y(self._fit(frame, vi))
            if not overshot:
                return
            # まだ1枚も返していないのでやり直せる。もっと手前から読む
            back *= 4

    def _decode_tolerant(self):
        """壊れたパケットを飛ばしながらデコードする。

        放送のTSは録画の切れ目で壊れたパケットが混ざる。container.decode() は
        その1つで例外を上げて止まるため、解析そのものが落ちていた
        （実測: ある録画の配信の長時間の取り込みで
         av.error.InvalidDataError: 'avcodec_send_packet()'）。
        音声側(chapterexe_py の extract_audio_table)には元から同じ握り潰しが
        あり、映像側だけ無かった。

        飛ばした数は decode_errors に貯める。丸ごと壊れた TS を「少し欠けただけ」
        と取り違えないよう、呼び出し側が見られるようにしておく。
        """
        for pkt in self.container.demux(self.stream):
            try:
                frames = pkt.decode()
            except Exception:
                self.decode_errors += 1
                continue
            yield from frames

    def _seek(self, first: int, back: int, fpts, tb: float, spf: float) -> int:
        """first-back フレーム手前へ飛び、実際に狙った位置を返す。

        MPEG-TS には索引が無く、libav は時刻で当たりを付けてから**次の**
        キーフレームまで進む。GOP が長いと狙いより後ろに着く。
        MPEG-2 は GOP 15 前後なので余裕30で足りていたが、H.265 は
        90フレーム(3秒)を超えることがあり、実測で 90 フレーム行き過ぎた。
        行き過ぎは呼び出し側が検出して back を増やして呼び直す。

        先頭まで戻るときは seek せず開き直す。先頭フレームの PTS を指定しても
        libav が次のキーフレームまで進んでしまい、0番に戻れないため。
        """
        target = max(0, first - back)
        if target == 0:
            if self._used:
                self._reopen()
            return 0
        ts = (fpts[min(target, len(fpts) - 1)] if fpts is not None
              else int(self._first_pts() + target * spf / tb))
        try:
            self.container.seek(ts, backward=True, any_frame=False, stream=self.stream)
            self.stream.codec_context.flush_buffers()
        except Exception:
            self._reopen()      # seek に失敗したら先頭から読む（正しさは保たれる）
            return 0
        return target

    def _reopen(self) -> None:
        """コンテナを開き直して先頭に戻す。"""
        pid = self.stream.id
        self.close()
        self.container = self._av.open(self.path)
        streams = [s for s in self.container.streams if s.type == 'video']
        self.stream = next((s for s in streams if s.id == pid), streams[0])
        self._setup_threads()
