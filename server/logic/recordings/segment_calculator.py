"""segment_calculator — 録画の時間区間リストを生成する（複数話の分割・単話のfullマーカー）"""

import json
from datetime import datetime


def episode_list(v) -> list:
    """話数・副題の値をリストにする。

    単話はスカラー(文字列/数値)で保存されるので1要素のリストに包む。JSON 配列の文字列は読む。
    空文字と None は0件。録画の登録と録画一覧で共通に使う。
    """
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
        return [v] if v.strip() else []
    return [v] if v is not None else []


def calculate_segments(
    eit_start_time: str,
    eit_end_time: str,
    episode_count: int,
    rec_start_time: str | None = None,
    file_duration_sec: float | None = None,
) -> list[str] | None:
    """録画オフセットとファイル実尺を考慮した時間区間リストを返す。

    - 録画が早い/ちょうど (offset <= 0):
        先頭は 00:00:00.000、中間は per_ep の倍数、末尾はファイル実尺
    - 録画が遅い (offset > 0):
        各境界 = n * per_ep - offset、ファイル開始前のエピソードは欠損扱い (0-0)、末尾はファイル実尺

    Returns:
        ["HH:MM:SS.mmm-HH:MM:SS.mmm", ...] または None（計算不可の場合）。
        単話(episode_count==1)は分割不要の全体マーカー ["full"] を返す
        （時間情報が無くても返す。video重複のSKIP判定を単話にも通すため）。
    """
    if episode_count == 1:
        return ['full']
    if not eit_start_time or not eit_end_time or episode_count < 2:
        return None
    try:
        eit_start = datetime.fromisoformat(eit_start_time).replace(tzinfo=None)
        eit_end   = datetime.fromisoformat(eit_end_time).replace(tzinfo=None)
        broadcast_ms = int((eit_end - eit_start).total_seconds() * 1000)
        if broadcast_ms <= 0:
            return None

        per_ep_ms = (broadcast_ms // episode_count // 60000) * 60000

        offset_ms = 0
        if rec_start_time:
            rec_start = datetime.fromisoformat(rec_start_time).replace(tzinfo=None)
            offset_ms = int((rec_start - eit_start).total_seconds() * 1000)

        file_dur_ms = int(file_duration_sec * 1000) if file_duration_sec is not None else broadcast_ms

        def _seg(s_ms, e_ms):
            """ファイル実尺に収まるように区間を整える。

            枠を話数で割った境界はファイル末尾を追い越すことがある（録画が途中で
            切れた場合や、CM を捨てて録る取り込みのように中身が枠より短い場合）。
            そのまま出すと終了が開始より前の区間ができ、分割画面はその範囲の
            フレームを取れずに黒くなる（実測: 10時間枠に対し中身
            7時間52分で "09:30:00.000-07:52:16.135" が出ていた）。
            ファイル末尾より後ろから始まる話は、先頭より前の話と同じく欠損扱いにする。
            """
            if s_ms >= file_dur_ms:
                return "00:00:00.000-00:00:00.000,SKIP"
            return f"{_fmt(s_ms)}-{_fmt(min(e_ms, file_dur_ms))}"

        result = []
        if offset_ms <= 0:
            # 録画が早い/ちょうど: 先頭から per_ep 刻み、末尾はファイル実尺
            for i in range(episode_count):
                s_ms = per_ep_ms * i
                e_ms = per_ep_ms * (i + 1) if i < episode_count - 1 else file_dur_ms
                result.append(_seg(s_ms, e_ms))
        else:
            # 録画が遅い: オフセット分だけ境界をずらす
            for i in range(episode_count):
                ep_end_ms   = per_ep_ms * (i + 1) - offset_ms
                ep_start_ms = per_ep_ms * i        - offset_ms

                if ep_end_ms <= 0:
                    result.append("00:00:00.000-00:00:00.000,SKIP")
                else:
                    s_ms = max(0, ep_start_ms)
                    e_ms = ep_end_ms if i < episode_count - 1 else file_dur_ms
                    result.append(_seg(s_ms, e_ms))

        return result
    except Exception:
        return None


def mark_registered_segments_skip(
    segments: list[str],
    video_db,
    sid,
    folder,
    title,
    episode_numbers: list,
    episode_names: list,
    categories=None,
) -> list[str]:
    """既に videos に「ドロップ/スクランブル無し」で登録済みの話を ',SKIP' タグ付きにする。

    話 i を (sid, folder, title, episode_number[i], episode_name[i]) で videos と照合し、
    クリーンな一致動画があれば segments[i] に ',SKIP' を付与する。
    categories(録画のカテゴリ名list)が与えられた場合はカテゴリの一致も要求する。
    既に ',SKIP' を含む話（欠損話など）や、video_db が None の場合はそのまま返す。
    """
    if not segments or video_db is None:
        return segments

    out = []
    for i, seg in enumerate(segments):
        en = episode_numbers[i] if i < len(episode_numbers) else None
        nm = episode_names[i]   if i < len(episode_names)   else None
        if (isinstance(seg, str) and ',SKIP' not in seg
                and video_db.has_clean_episode(sid, _at(folder, i), _at(title, i), en, nm,
                                               category=categories)):
            out.append(f"{seg},SKIP")
        else:
            out.append(seg)
    return out


def _at(v, i):
    # folder/title は呼び出し元により list / JSON 配列文字列 / スカラーになりうる。
    # list は i 番目（範囲外は先頭でブロードキャスト）、スカラーはそのまま。
    if isinstance(v, str) and v.startswith('['):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                v = parsed
        except (json.JSONDecodeError, ValueError):
            pass
    if isinstance(v, list):
        return v[i] if i < len(v) else (v[0] if v else None)
    return v




def _fmt(ms: int) -> str:
    h  =  ms // 3600000
    m  = (ms %  3600000) // 60000
    s  = (ms %    60000) // 1000
    f  =  ms %     1000
    return f"{h:02d}:{m:02d}:{s:02d}.{f:03d}"
