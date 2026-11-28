"""TOT を基準にしたトリム"""

import json
from datetime import datetime, timedelta
from typing import Optional
from .common import (  # noqa: F401
    logger,
)
from .placeholders import (  # noqa: F401
    _parse_dt,
)


# ---------------------------------------------------------------------------
# TOT トリム
# ---------------------------------------------------------------------------

def _tot_overlap(trim_segments: list, rec_start, rec_end) -> Optional[float]:
    """区間の TOT 時刻の範囲が、録画の時間帯と重なる長さ(秒)。読めなければ None。"""
    starts = [d for d in (_parse_dt(sg.get('start')) for sg in trim_segments) if d]
    ends = [d for d in (_parse_dt(sg.get('end')) for sg in trim_segments) if d]
    if not starts or not ends:
        return None
    lo, hi = max(min(starts), rec_start), min(max(ends), rec_end)
    return max(0.0, (hi - lo).total_seconds())


def _fix_trim_times(trim_segments: list, rec_start_str: Optional[str],
                    rec_end_str: Optional[str]) -> list:
    """トリム区間の絶対時刻が録画の範囲から外れていたら、フレーム番号で付け直す。

    区間の時刻は TS の TOT から引いているが、TOT に紐づく映像PTSが乏しい
    (映像PIDの判定がずれている等)と、トリム点のPTSが TOT の範囲より後ろになり、
    最後の TOT から 1:1 で外挿されて録画終了後の時刻に化ける。
    実例: 録画 15:30〜15:59 の回で区間が 15:59:50〜16:27:15 になり、
    コメントが全部範囲外になって 0 件になった。

    映像のカット位置そのもの(フレーム/PTS)は正しいので、録画開始 + フレーム/fps で
    時刻だけ引き直す。fps は区間のフレーム数と再生時間から求める。
    """
    if not trim_segments or not rec_start_str:
        return trim_segments
    rec_start = _parse_dt(rec_start_str)
    rec_end = _parse_dt(rec_end_str) if rec_end_str else None
    if rec_start is None:
        return trim_segments

    # 録画の範囲(前後1分の余裕つき)から外れた区間があれば、TOT 由来の時刻は信用しない
    margin = timedelta(seconds=60)
    lo, hi = rec_start - margin, (rec_end + margin) if rec_end else None
    bad = False
    for seg in trim_segments:
        for key in ('start', 'end'):
            dt = _parse_dt(seg.get(key))
            if dt is None or dt < lo or (hi is not None and dt > hi):
                bad = True
    if not bad:
        return trim_segments

    # 録画範囲を少しはみ出すだけなら TOT を信用する。外挿で化けた時刻は録画時間帯から
    # 丸ごと外れる（実例: 録画 15:30〜15:59 に対し区間が 15:59:50〜16:27:15）が、
    # 録画メタの方が実ファイルと違うだけなら（入力が録画そのものでない場合。例: 既に
    # エンコード済みのTSを取り込んだ回は 02:04:55〜02:35:00 で録画メタの24分を包む）
    # 時間帯は重なる。ここで捨てると正しい時刻を捨てて間違った録画時刻に合わせてしまい、
    # 字幕・コメントが実尺との差のぶんずれる。
    if rec_end is not None:
        span = _tot_overlap(trim_segments, rec_start, rec_end)
        rec_len = (rec_end - rec_start).total_seconds()
        if span is not None and rec_len > 0 and span >= rec_len * 0.5:
            logger.info('run_encoded_analyze: トリム時刻は録画範囲を外れるが時間帯が'
                        '重なる(%.0f%%)ためそのまま使います', 100 * span / rec_len)
            return trim_segments

    # fps はフレーム数が最も多い区間から求める(短い区間だと誤差が大きいため)
    best = max(trim_segments,
               key=lambda sg: (sg.get('end_frame') or 0) - (sg.get('start_frame') or 0))
    frames = (best.get('end_frame') or 0) - (best.get('start_frame') or 0)
    dur = best.get('duration_sec') or 0
    fps = frames / dur if frames > 0 and dur > 0 else 0.0
    if not 1 < fps < 121:
        logger.warning('run_encoded_analyze: トリム時刻が録画範囲外だが fps を出せず補正できません')
        return trim_segments

    fixed = []
    for seg in trim_segments:
        sf, ef = seg.get('start_frame'), seg.get('end_frame')
        if sf is None or ef is None:
            fixed.append(seg)
            continue
        fixed.append({**seg,
                      'start': (rec_start + timedelta(seconds=sf / fps)).isoformat(),
                      'end':   (rec_start + timedelta(seconds=ef / fps)).isoformat()})
    logger.warning('run_encoded_analyze: トリム時刻が録画範囲外(TOTのPTS対応が不正)のため '
                   'フレーム番号で付け直しました (fps=%.3f, %s → %s)',
                   fps, trim_segments[0].get('start'), fixed[0].get('start'))
    return fixed


def _refetch_comments(enc: dict, trim_segments: list) -> Optional[str]:
    """実況コメントを取り直して既存へマージした JSON 文字列を返す。

    録画直後(add_recording)の取得は過去ログAPIが追いついておらず、末尾が数分ぶん
    欠けることがある。エンコード後のこの時点なら埋まっているので取り直す。
    件数が減らないよう常にマージし、取得できなければ元の comments_json を返す。
    コメントの time は _trim_comments が date から振り直すのでここでは触らない。
    """
    cur_str = enc.get('comments_json')
    sid = enc.get('sid')
    if not sid or not trim_segments:
        return cur_str
    start = _parse_dt(trim_segments[0].get('start'))
    end   = _parse_dt(trim_segments[-1].get('end'))
    if start is None or end is None:
        return cur_str
    if end > datetime.now():
        # 未来の範囲＝TOT由来の時刻が壊れている。誤った時間帯のコメントを拾わない
        logger.warning('run_encoded_analyze: トリム時刻が未来(%s)のためコメント再取得を見送ります', end)
        return cur_str

    try:
        from read_tsprogram.comments import fetch_program_comments
        fetched = fetch_program_comments(int(sid),
                                         start - timedelta(seconds=60),
                                         end + timedelta(seconds=60))
    except Exception as e:
        logger.warning('run_encoded_analyze: コメント再取得に失敗: %s', e)
        return cur_str
    if not fetched:
        return cur_str

    try:
        new_comments = (json.loads(fetched) or {}).get('comments') or []
        cur = json.loads(cur_str) if cur_str else {}
        if not isinstance(cur, dict):
            cur = {}
        cur_comments = cur.get('comments') or []
        keys = {(c.get('date'), c.get('author'), c.get('text')) for c in cur_comments}
        added = [c for c in new_comments
                 if (c.get('date'), c.get('author'), c.get('text')) not in keys]
        if not added:
            return cur_str
        cur['comments'] = sorted(cur_comments + added, key=lambda c: c.get('date') or '')
        logger.info('run_encoded_analyze: コメント再取得 +%d件 (計%d件)',
                    len(added), len(cur['comments']))
        return json.dumps(cur, ensure_ascii=False)
    except Exception as e:
        logger.warning('run_encoded_analyze: コメントのマージに失敗: %s', e)
        return cur_str


