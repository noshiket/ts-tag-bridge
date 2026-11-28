"""TOT との対応・記録・区間の入れ替え"""



def tot_mapper(trim_segments):
    """動画内の秒 → 放送時刻(TOT) に直す関数を返す。取れない場合は None を返す関数。

    trim_segments は各区間の start(放送時刻) と duration_sec を持つので、
    先頭からの累積で「動画内の秒」と対応が付く。トリムで切られた分をまたいでも
    正しい放送時刻になる（動画内の秒をそのまま足すと CM を抜いた分ずれる）。
    """
    from datetime import datetime, timedelta

    segs = []
    t = 0.0
    for s in (trim_segments or []):
        try:
            start = datetime.fromisoformat(str(s['start']))
            dur = float(s['duration_sec'])
        except (KeyError, TypeError, ValueError):
            continue
        segs.append((t, t + dur, start))
        t += dur

    def at(sec):
        if sec is None:
            return None
        for lo, hi, start in segs:
            if lo <= sec <= hi:
                return (start + timedelta(seconds=sec - lo)).isoformat()
        return None

    return at


def sync_record(source, ranges, video_check, *, segments_a=None, segments_b=None,
                method=None):
    """tag.json へ残す同期の記録を作る。

    トリムや再エンコードで動画内の秒はいくらでも変わるので、放送時刻(TOT)でも
    持っておく。取り込み元は onid-tsid-sid-eid と eit_start_time で特定する。
    """
    from datetime import datetime

    tot_a = tot_mapper(segments_a)
    tot_b = tot_mapper(segments_b)
    out = []
    for i, r in enumerate(ranges):
        v = (video_check or [None] * len(ranges))[i] if i < len(video_check or []) else None
        out.append({
            'a_start': r['a_start'], 'a_end': r['a_end'],
            'b_start': r['b_start'], 'b_end': r['b_end'],
            'offset': r['offset'], 'coarse_offset': r.get('coarse_offset'),
            'a_start_tot': tot_a(r['a_start']), 'a_end_tot': tot_a(r['a_end']),
            'b_start_tot': tot_b(r['b_start']), 'b_end_tot': tot_b(r['b_end']),
            'video_frame_offset': (v or {}).get('frame_offset'),
            'video_judged': bool((v or {}).get('judged')),
            # チャプター区間で割った単位ごとの内訳（どこで一致を取ったか）
            'units': [{'a_start': u['a_start'], 'a_end': u['a_end'], 'ok': u['ok'],
                       'sec': u['sec'], 'frame_offset': u['frame_offset'],
                       'audio_diff_ms': u['audio_diff_ms']}
                      for u in (v or {}).get('units', []) if u.get('judged')],
        })
    return {
        'applied_at': datetime.now().isoformat(),
        # 既定は波形のサンプル単位相互相関で求めたずれ。音声比較だけで取り込んだ
        # 場合は求め方が違う('audio_overlap' = 500ms の特徴量一致)ので呼び出し側が渡す
        'method': method or 'audio_xcorr',
        'source': source,
        'ranges': out,
    }


def swap_ranges(ranges) -> list:
    """区間の A と B を入れ替える（相手側の tag.json へ同じ対応を書くため）。

    一致は双方向の情報なので、取り込み元の側にも「どの放送のどの区間と合っていたか」を
    残す。ずれは向きが逆になるので符号を反転する。
    """
    out = []
    for r in ranges:
        out.append({**r,
                    'a_start': r['b_start'], 'a_end': r['b_end'],
                    'b_start': r['a_start'], 'b_end': r['a_end'],
                    'offset': -r['offset'],
                    'coarse_offset': (-r['coarse_offset']
                                      if r.get('coarse_offset') is not None else None)})
    return out


def to_build_ranges(ranges) -> list:
    """audio_compare.remap がそのまま食える (b_start, b_end, offset) にする。

    ずれが同じ隣り合う区間は繋ぐ（音が少し違うだけで一致が切れた穴を落とさない。
    audio_compare.bridge_ranges を参照）。
    """
    from logic.audio_compare.remap import bridge_ranges
    return bridge_ranges(sorted((r['b_start'], r['b_end'], r['offset']) for r in ranges
                                if r['b_end'] > r['b_start']))
