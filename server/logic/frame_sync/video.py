"""映像が同じずれで合っているかの確認（verify_video）と判定点"""

from logic import audio_overlap
from .refine import (
    _CONTRAST_MIN,
    _CORR_MIN,
    _GRID_FPS,
    _MIN_CORR,
    _MIN_SCAN_FRAMES,
    _MIN_UNIT_SEC,
    _NICE,
    _OK_FRAMES,
    _SCAN_FRAMES,
    _TRIES,
    _load,
)
from .xcorr import _WINDOW_SEC
from .xcorr import _xcorr_offset, throttle
from .frame_signal import _check_at


def _units(r, bounds_a, bounds_b, min_sec=_MIN_UNIT_SEC):
    """共通区間を、A と B 両方のチャプター境界で割った単位に分ける。

    チャプター区間の中は CM カットが入らないので内容が連続している。A と B の境界を
    重ねて細かい方で割ると、「ここまでは連続」と言い切れる最小の単位になる。
    その単位の中で無音箇所が1つ合えば、単位全体が合っていると見なせる。

    B の境界は offset を足して A の時間軸へ写す（A秒 = B秒 + offset）。
    細切れになりすぎないよう、min_sec 未満の断片は手前へ吸収する。
    """
    cuts = {r['a_start'], r['a_end']}
    for b in (bounds_a or []):
        if r['a_start'] < b < r['a_end']:
            cuts.add(float(b))
    for b in (bounds_b or []):
        a = float(b) + r['offset']
        if r['a_start'] < a < r['a_end']:
            cuts.add(a)
    xs = sorted(cuts)
    out = []
    for lo, hi in zip(xs, xs[1:]):
        if out and hi - lo < min_sec:
            out[-1] = (out[-1][0], hi)
        else:
            out.append((lo, hi))
    return out or [(r['a_start'], r['a_end'])]


def _audio_local(ya, yb, sec, offset, window_sec=_WINDOW_SEC):
    """その場所での音声のずれが、区間のずれと合っているかを返す。

    戻り: (区間のずれとの差(秒), 相関)。測れなければ (None, 0.0)。
    音声はサンプル単位で測れるので、ここでフレームより細かく効いているかを確かめる。
    """
    off, corr = _xcorr_offset(ya, yb, sec + window_sec / 2, base_offset=-offset)
    if off is None:
        return None, 0.0
    return (-off) - offset, corr


def _judged(r):
    """フレーム単位の判定が成立しているか。変化があり、かつ同じ内容を見ていること。"""
    return r['contrast'] >= _CONTRAST_MIN and r['score'] >= _CORR_MIN


def verify_video(path_a, path_b, ranges, *, ffmpeg='ffmpeg', on_log=None,
                 hints=None, tries=_TRIES, tolerance=_OK_FRAMES,
                 bounds_a=None, bounds_b=None, wav_dir=None,
                 nice=_NICE, max_load=None):
    """音声で求めたずれで映像も合っているかを確かめる。

    音声と映像の開始位置がずれている放送があるため、音声一致だけでは担保できない。

    判定はチャプター区間の単位で行う。共通区間を A と B 両方のチャプター境界で割ると、
    「ここまでは CM カットが入らず内容が連続している」と言い切れる最小の単位になる
    (_units)。その単位の中の無音箇所で、

      - 音声: その場所のずれが区間のずれと 1フレーム以内で合っているか（サンプル単位）
      - 映像: 「いつ絵が変わったか」の系列が 1フレーム単位で合っているか

    の両方が取れれば、その単位は合っていると見なす。中央か端かは問わない。
    合う箇所が1つ見つかった時点でその単位は打ち切る。

    hints: {区間index: [無音箇所の秒,...]}。bounds_a/bounds_b はチャプター位置。
    wav_dir を渡すと音声の確認も行う（渡さなければ映像だけ）。

    戻り値は ranges と同じ長さのリスト:
      {sec, frame_offset, score, contrast, ok, judged, samples, units}
      units は単位ごとの内訳 [{a_start, a_end, ok, judged, sec, frame_offset, audio_diff_ms}]
    """
    log = on_log or (lambda _m: None)
    ya = yb = None
    ctx = audio_overlap._keep_dir(wav_dir) if wav_dir else None
    if ctx is not None:
        with ctx as tmp:
            ya = _load(path_a, ffmpeg, tmp, 'a.wav', log, nice)
            yb = _load(path_b, ffmpeg, tmp, 'b.wav', log, nice)

    out = []
    for i, r in enumerate(ranges):
        marks = list((hints or {}).get(i) or [])
        units = []
        for u0, u1 in _units(r, bounds_a, bounds_b):
            span = u1 - u0
            n = min(_SCAN_FRAMES, int(span * _GRID_FPS) - 1)
            if n < _MIN_SCAN_FRAMES:
                units.append({'a_start': round(u0, 3), 'a_end': round(u1, 3),
                              'judged': False, 'ok': True, 'sec': None,
                              'frame_offset': None, 'audio_diff_ms': None,
                              'audio_mismatch': False})
                continue
            lo, hi = u0, u1 - n / _GRID_FPS
            # 単位の中の無音箇所を優先し、無ければ等分した位置
            cands = [m for m in marks if lo <= m <= hi][:max(1, tries)]
            cands += [lo + (hi - lo) * f for f in (0.5, 0.25, 0.75)][:max(1, tries)]
            hit = bad_audio = None
            for sec in cands:
                if not (lo <= sec <= hi):
                    continue
                throttle(max_load)      # フレーム取り出しの前に譲る
                got = _check_at(path_a, path_b, sec, r['offset'], ffmpeg, frames=n, nice=nice)
                if got is None or not _judged(got):
                    continue        # 場面の切り替わりが無い＝この場所では測れない
                # 同じ場所で音声も合っているか（サンプル単位で測って1フレーム以内）
                adiff = None
                if ya is not None:
                    d, acorr = _audio_local(ya, yb, sec, r['offset'])
                    if d is None or acorr < _MIN_CORR:
                        continue    # 音声が測れない場所
                    adiff = round(d * 1000, 2)
                    if abs(d) > 1.0 / _GRID_FPS:
                        # 映像は測れているのに音声が区間のずれと合わない。
                        # 「測れなかった」ではなく食い違いとして残す
                        bad_audio = {'sec': got['sec'], 'frame_offset': got['frame_offset'],
                                     'audio_diff_ms': adiff}
                        continue
                hit = {'sec': got['sec'], 'frame_offset': got['frame_offset'],
                       'audio_diff_ms': adiff}
                if abs(got['frame_offset']) <= tolerance:
                    break       # 合う箇所が1つあればこの単位は済み
            u = hit or bad_audio
            units.append({
                'a_start': round(u0, 3), 'a_end': round(u1, 3),
                'judged': u is not None,
                'ok': hit is not None and abs(hit['frame_offset']) <= tolerance,
                'sec': (u or {}).get('sec'), 'frame_offset': (u or {}).get('frame_offset'),
                'audio_diff_ms': (u or {}).get('audio_diff_ms'),
                'audio_mismatch': hit is None and bad_audio is not None,
            })

        done = [u for u in units if u['judged']]
        if done:
            offs = sorted(u['frame_offset'] for u in done)
            res = {'sec': done[0]['sec'], 'frame_offset': offs[len(offs) // 2],
                   'score': 0.0, 'contrast': 0.0, 'judged': True,
                   'samples': len(done), 'units': units}
            res['ok'] = all(u['ok'] for u in done)
            bad = [u for u in done if u.get('audio_mismatch')]
            log(f'区間{i + 1}: 映像 {res["frame_offset"]:+d}フレーム '
                f'（{len(done)}/{len(units)}単位が一致） '
                + ('OK' if res['ok'] else
                   (f'音声が合いません（{bad[0]["audio_diff_ms"]}ms）' if bad
                    else '音声とずれています')))
        else:
            res = {'sec': None, 'frame_offset': None, 'score': 0.0, 'contrast': 0.0,
                   'judged': False, 'ok': True, 'samples': 0, 'units': units}
            log(f'区間{i + 1}: 判定できません（{len(units)}単位すべてで一致が取れず）')
        out.append(res)
    return out
