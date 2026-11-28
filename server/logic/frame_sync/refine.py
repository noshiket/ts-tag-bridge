"""優先度・負荷の待ちと、音声の相互相関によるずれの測り直し（refine）"""

import logging
import os
import tempfile
import numpy as np
from logic import audio_overlap
from .xcorr import _WINDOW_SEC, _bisect_step, _runs, _xcorr_offset, throttle


logger = logging.getLogger('logic.frame_sync')   # 分ける前と同じ名前で出す

_PROBE_SEC = 20.0           # 区間内でずれを測る間隔
_MIN_CORR = 0.70            # これ未満の測定点は捨てる
# 測定値がこれ以上離れたら「別のずれ」として区間を切る。1フレーム(33.4ms)より十分小さく、
# 相互相関の揺らぎ(実測で同一runは 0.0ms)より十分大きい値にする
_STEP_TOL_SEC = 0.005
# チャプター境界で割った単位がこれより短ければ手前へ吸収する（細切れにしない）
_MIN_UNIT_SEC = 8.0
# 既定の優先度下げ幅。CM解析(logic.cmcut)と同じ 10。急がないのでさらに下げてもよい
_NICE = 10


def _load(path, ffmpeg, tmp, name, log, nice=_NICE):
    wav = os.path.join(tmp, name)
    # 音声比較(audio_overlap.analyze)が同じ場所へ抽出済みならそれを使う
    if not os.path.exists(wav):
        log(f'音声を抽出中: {os.path.basename(path)}')
        audio_overlap.extract_audio(path, wav, ffmpeg=ffmpeg, nice=nice)
    y, _sr = audio_overlap._read_wav_mono(wav)
    # 24分で float64 だと 184MB。精度は相関に十分なので float32 で持つ
    return np.asarray(y, dtype=np.float32)


def refine(path_a, path_b, matches, *, ffmpeg='ffmpeg', on_log=None, wav_dir=None,
           probe_sec=_PROBE_SEC, min_corr=_MIN_CORR, step_tol=_STEP_TOL_SEC,
           nice=_NICE, max_load=None):
    """matches の各区間のずれをサンプル単位で測り直す。

    matches は audio_overlap.analyze の戻り値。
    戻り値は各区間 1 件の dict:
      a_start, a_end : この動画(A)の秒
      b_start, b_end : 取り込み元(B)の秒
      offset         : B の秒 → A の秒 への加算値(build_ranges と符号を揃える)
      coarse_offset  : 音声一致が出していた粗いずれ
      corr           : 測定点の相関の中央値
      samples        : 使えた測定点の数
      spread_ms      : 区間内の測定値のばらつき(最大-最小)
    測定点が1つも取れない区間は coarse のまま返す(samples=0)。
    """
    log = on_log or (lambda _m: None)
    out = []
    ctx = audio_overlap._keep_dir(wav_dir) if wav_dir else tempfile.TemporaryDirectory()
    with ctx as tmp:
        ya = _load(path_a, ffmpeg, tmp, 'a.wav', log, nice)
        yb = _load(path_b, ffmpeg, tmp, 'b.wav', log, nice)

        for i, m in enumerate(matches or []):
            try:
                a0 = audio_overlap.parse_time(m['videoA']['start'])
                a1 = audio_overlap.parse_time(m['videoA']['end'])
                b0 = audio_overlap.parse_time(m['videoB']['start'])
                b1 = audio_overlap.parse_time(m['videoB']['end'])
            except (KeyError, TypeError, ValueError):
                continue
            coarse = a0 - b0            # B の秒 → A の秒
            # 区間の端は内容が違いはじめる境目なので少し内側だけを測る
            lo, hi = a0 + _WINDOW_SEC / 2, a1 - _WINDOW_SEC / 2
            probes = []
            t = lo
            while t <= hi:
                probes.append(t)
                t += probe_sec
            if not probes and hi > lo:
                probes = [(lo + hi) / 2]

            got = []            # [(A の秒, B→A のずれ, 相関)]
            for t in probes:
                throttle(max_load)      # 他の重い処理と食い合わないよう譲る
                off, sc = _xcorr_offset(ya, yb, t, base_offset=-coarse)
                if off is None or sc < min_corr:
                    continue
                got.append((t, -off, sc))       # -off で B→A へ戻す

            if not got:
                out.append({'a_start': a0, 'a_end': a1, 'b_start': b0, 'b_end': b1,
                            'offset': round(coarse, 6), 'coarse_offset': round(coarse, 6),
                            'corr': 0.0, 'samples': 0, 'spread_ms': 0.0})
                log(f'区間{i + 1}: A {a0:.1f}-{a1:.1f}s  測定できず（粗いずれのまま）')
                continue

            runs = _runs([(t, o) for t, o, _s in got], step_tol)
            corr_of = {t: s for t, _o, s in got}
            # run の境目(=段差)を二分探索で詰めて、A の秒で区間を切り直す
            bounds = [a0]
            for k in range(len(runs) - 1):
                lo_t, lo_off = runs[k][-1]
                hi_t = runs[k + 1][0][0]
                bounds.append(_bisect_step(ya, yb, lo_t, hi_t, lo_off, -coarse,
                                           step_tol, min_corr))
            bounds.append(a1)

            for k, run in enumerate(runs):
                v = np.array([o for _t, o in run])
                offset = float(np.median(v))
                spread = float(v.max() - v.min()) * 1000.0
                corr = float(np.median([corr_of[t] for t, _o in run]))
                ra0, ra1 = bounds[k], bounds[k + 1]
                out.append({
                    'a_start': round(ra0, 3), 'a_end': round(ra1, 3),
                    'b_start': round(ra0 - offset, 3), 'b_end': round(ra1 - offset, 3),
                    'offset': round(offset, 6), 'coarse_offset': round(coarse, 6),
                    'corr': round(corr, 4), 'samples': len(run),
                    'spread_ms': round(spread, 2),
                })
                tag = f'区間{i + 1}' + (f'-{k + 1}' if len(runs) > 1 else '')
                log(f'{tag}: A {ra0:.1f}-{ra1:.1f}s  ずれ {coarse * 1000:+.0f}ms → '
                    f'{offset * 1000:+.1f}ms  (測定{len(run)}点 ばらつき{spread:.1f}ms '
                    f'相関{corr:.3f})')
    return out


# ---------------------------------------------------------------------------
# 映像の確認
# ---------------------------------------------------------------------------

_CROP = 'crop=iw/2:ih/2'    # テロップ・局ロゴは端に出るので中央だけ見る
_SIZE = 32                  # 低解像度に落とす(細部の符号化差を無視する)
_GRID_FPS = 30              # 可変フレームレートを均すためのグリッド
# 変化の系列を取る長さ(5秒)。短いと1箇所の読みが場所によって振れる。実測(10区間を
# 各1箇所だけ読んだ場合): 2秒だと -3 や +7 という外れ値が出るが、5秒なら全区間が
# -1〜0 に収まった。窓を伸ばすほうが、短い窓を複数箇所読むより速くて正確
# (実測 31秒 対 81秒)
_SCAN_FRAMES = 150
# 短い区間では走査幅を詰める。ずれの探索幅(±8)の前後に十分な長さが要るのでこれが下限
_MIN_SCAN_FRAMES = 24
_MAX_LAG = 8                # 探すフレームずれの範囲(±8/30秒 = ±267ms)
# 変化の鋭さがこれ未満なら「場面の切り替わりが無い」として判定しない。
# 実測: 本物の切り替わりは 12〜2046、ただの動きは 4.5 で、4.5 の点は3フレームずらしても
# 反応しなかった(=判定に使えない)
_CONTRAST_MIN = 10.0
# 変化の系列の相関がこれ未満なら、そもそも同じ内容を見ていない
# (実測: 内容が合っていれば 0.64〜0.99、片方だけCMが残る等で内容が違うと 0.15〜0.45)
_CORR_MIN = 0.55
_TRIES = 5                  # 判定できる場所を探して試す回数(2箇所揃えば打ち切る)
# 許容するフレームずれ。ずれの値そのものは音声側を採るので、ここは
# 「音声と映像で明らかにずれている」ことを拾うためのガード。
# 実測: 通常の組は 10区間すべて 0〜-1 に収まる。L字テロップが入る組(放送異常告知あり)は
# +1〜+2 まで散ったので、告知がある側は 2 まで許す(_OK_FRAMES_ANNOUNCE)。
# 一律 2 にすると通常の組で 3フレームのずれを取りこぼす(対照実験で 5/10 しか検出できず、
# 1 にすれば 10/10 取れる)ため、告知の有無で分ける。
_OK_FRAMES = 1
_OK_FRAMES_ANNOUNCE = 2
