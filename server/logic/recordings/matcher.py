"""matcher — 録画結果一覧から TS ファイルパスを照合"""

from datetime import datetime, timedelta
from typing import List


# プログラム予約(時刻指定予約)の eid。EDCB は予約ごとの区別なく全て 0xFFFF を入れるため、
# reserve_key だけでは同一サービスの別のプログラム予約と区別できない。
_MANUAL_EID = 0xFFFF
# プログラム予約の時刻照合に許すズレ（前後マージン付きで録画されるため）
_MANUAL_MARGIN_SEC = 300


def _naive(s: str):
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def _overlaps_reserve(rec: dict, start_time: str, end_time: str) -> bool:
    """録画結果の時間帯が予約の時間帯（前後マージン付き）と重なるか。

    プログラム予約は eid が全て 0xFFFF なので、eid 一致だけだと同一サービスの
    過去の（別日の）プログラム予約録画まで拾ってしまう。時刻で絞り込む。
    """
    r_start = _naive(rec.get('startTime') or rec.get('startTimeEpg') or '')
    if r_start is None:
        return False
    try:
        r_end = r_start + timedelta(seconds=int(rec.get('durationSecond') or 0))
    except (TypeError, ValueError):
        r_end = r_start

    p_start = _naive(start_time)
    if p_start is None:
        return False
    p_end = _naive(end_time) or p_start
    margin = timedelta(seconds=_MANUAL_MARGIN_SEC)
    return r_start <= p_end + margin and r_end >= p_start - margin


def find_all_rec_files(reserve_key: str, start_time: str, rec_list: list,
                       end_time: str = '') -> List[dict]:
    """
    録画結果一覧からマッチするすべての録画ファイルを返す。
    再起動等で1番組が複数ファイルに分割された場合にも全件収集する。

    照合順:
      1. reserve_key = "onid-tsid-sid-eid" で onid/tsid/sid/eid 完全一致 → 全件
         （eid=0xFFFF のプログラム予約だけは、さらに時間帯が重なるものに限る）
      2. 見つからない場合: sid 一致 かつ start_time 差が 2 分以内 → 全件

    Args:
        reserve_key: "onid-tsid-sid-eid" 形式の文字列
        start_time:  ISO8601 文字列（近傍マッチ用）
        rec_list:    enum_rec_info() が返すリスト
        end_time:    ISO8601 文字列（プログラム予約の時間帯照合用。無ければ開始時刻のみで判定）

    Returns:
        [{'rec_id': int, 'ts_path': str}, ...] のリスト（空の場合は []）
    """
    parts = reserve_key.split('-')
    if len(parts) != 4:
        return []

    try:
        onid, tsid, sid, eid = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
    except ValueError:
        return []

    def _rec_entry(rec: dict) -> dict:
        start = rec.get('startTimeEpg') or ''
        dur   = rec.get('durationSecond')
        if start and dur is not None:
            try:
                eit_end = (datetime.fromisoformat(start) + timedelta(seconds=dur)).isoformat()
            except (ValueError, TypeError):
                eit_end = ''
        else:
            eit_end = ''
        return {
            'rec_id':        rec.get('id'),
            'ts_path':       rec.get('recFilePath', ''),
            'rec_status':    rec.get('recStatus'),
            'rec_comment':   rec.get('comment', ''),
            'eit_start_time': start or None,
            'eit_end_time':   eit_end or None,
        }

    # 1. 完全一致 — 同一 eid の録画を全件収集
    results = []
    for rec in rec_list:
        if (rec.get('onid') == onid and rec.get('tsid') == tsid and
                rec.get('sid') == sid and rec.get('eid') == eid):
            if eid == _MANUAL_EID and not _overlaps_reserve(rec, start_time, end_time):
                continue
            results.append(_rec_entry(rec))

    if results:
        return results

    # 2. sid + start_time 近傍 (2 分以内) — 全件収集
    if not start_time:
        return []
    try:
        target = datetime.fromisoformat(start_time).replace(tzinfo=None)
    except (ValueError, TypeError):
        return []

    for rec in rec_list:
        if rec.get('sid') != sid:
            continue
        rec_start = rec.get('startTime', '')
        if not rec_start:
            continue
        try:
            rec_dt = datetime.fromisoformat(rec_start).replace(tzinfo=None)
            if abs((rec_dt - target).total_seconds()) <= 120:
                results.append(_rec_entry(rec))
        except (ValueError, TypeError):
            continue

    return results
