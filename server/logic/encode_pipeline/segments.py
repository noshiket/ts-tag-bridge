"""segments に TOT/PTS 情報を付ける"""

import data_paths  # server/ と server/data の場所
import re
from datetime import datetime, timedelta
from .head_refs import _resolve_maps
from .common import (  # noqa: F401
    logger,
)


# ---------------------------------------------------------------------------
# enrich_segments — segments に TOT/PTS 情報を付与
# ---------------------------------------------------------------------------

_TIME_RE = re.compile(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})')


def _data_dir() -> str:
    """server/data ディレクトリの絶対パス（video.db 等と同じ規約）。"""
    return data_paths.DATA_DIR


def _parse_hms(s: str) -> float:
    """'HH:MM:SS.mmm' → 秒"""
    m = _TIME_RE.fullmatch(s)
    if not m:
        raise ValueError(f"invalid time format: {s!r}")
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000


# 分割画面が保存する区間指定トークン。
# keep(...) = 採用区間（現行）。trim(...) = 除去区間（旧形式・読み取り互換のみ）。
_KEEP_RE = re.compile(r'^keep\((.+)-(.+)\)$')
_TRIM_RE = re.compile(r'^trim\((.+)-(.+)\)$')
# keep(開始-終了) / keep(開始-終了@チャプター名)。時刻に '-' '@' ')' は入らない
_RANGE_TOKEN_RE = re.compile(r'^(keep|trim)\(([^-@)]+)-([^-@)]+)(?:@([^)]*))?\)$')


def _collect_offsets(seg: str, offsets: set[float]):
    """segment 文字列から全時刻オフセットを offsets に追加する。"""
    parts = seg.split(',')
    start_str, end_str = parts[0].split('-', 1)
    offsets.add(_parse_hms(start_str))
    offsets.add(_parse_hms(end_str))
    for p in parts[1:]:
        m = _RANGE_TOKEN_RE.match(p.strip())
        if m:
            offsets.add(_parse_hms(m[2]))
            offsets.add(_parse_hms(m[3]))


def enrich_segments(
    ts_path: str,
    recording_start_time: str,
    segments: list[str],
) -> list[str]:
    """segments 文字列リストに TOT / PTS 情報を付与して返す。

    TS 先頭チャンクから first_pts + TOT 参照点を取得し、
    各オフセットの PTS は算術計算、TOT は参照点から補間する。
    TOT 参照点が取れなかった場合は recording_start_time でフォールバック。
    エラー時は元の segments をそのまま返す。
    """
    try:
        offsets: set[float] = set()
        for seg in segments:
            _collect_offsets(seg, offsets)
        pts_map, tot_map = _resolve_maps(ts_path, sorted(offsets))
        rec_start = datetime.fromisoformat(recording_start_time)
    except Exception:
        logger.warning("enrich_segments: TS 走査失敗, segments をそのまま返します", exc_info=True)
        return segments

    enriched: list[str] = []
    for seg in segments:
        try:
            enriched.append(_enrich_one(seg, pts_map, tot_map, rec_start))
        except Exception:
            logger.warning("enrich_segments: segment パース失敗: %s", seg, exc_info=True)
            enriched.append(seg)
    return enriched


def _tot_iso(tot_map: dict, offset_sec: float, rec_start: datetime) -> str:
    """TOT map から ISO 文字列を返す。なければ rec_start + offset で算出。"""
    t = tot_map.get(offset_sec)
    if t is None:
        t = rec_start + timedelta(seconds=offset_sec)
    return t.isoformat()


def _enrich_one(seg: str, pts_map: dict[float, int],
                tot_map: dict[float, datetime], rec_start: datetime) -> str:
    """1 segment 文字列を enriched 形式に変換する。"""
    parts = seg.split(',')
    range_part = parts[0]
    start_str, end_str = range_part.split('-', 1)
    start_sec = _parse_hms(start_str)
    end_sec = _parse_hms(end_str)

    tokens = [
        range_part,
        f"TOT({_tot_iso(tot_map, start_sec, rec_start)},{_tot_iso(tot_map, end_sec, rec_start)})",
        f"pts({pts_map[start_sec]},{pts_map[end_sec]})",
    ]

    # keep(...)=採用区間 / trim(...)=旧形式の除去区間。どちらもトークン名を保ったまま
    # 連番を振り、TOT/pts を併記する（意味が違うので keep と trim を混ぜて番号を振らない）
    idx = {'keep': 0, 'trim': 0}
    for p in parts[1:]:
        p = p.strip()
        m = _RANGE_TOKEN_RE.match(p)
        if not m:
            tokens.append(p)
            continue
        kind = m[1]
        idx[kind] += 1
        i = idx[kind]
        from_sec = _parse_hms(m[2])
        to_sec = _parse_hms(m[3])
        name = f'@{m[4]}' if m[4] else ''
        tokens.append(f"{kind}{i}({m[2]}-{m[3]}{name})")
        tokens.append(f"{kind}{i}.TOT({_tot_iso(tot_map, from_sec, rec_start)},{_tot_iso(tot_map, to_sec, rec_start)})")
        tokens.append(f"{kind}{i}.pts({pts_map[from_sec]},{pts_map[to_sec]})")

    return ','.join(tokens)
