"""重複録画の情報と自動スキップの判定"""

import json
from .segment_calculator import _at


def build_duplicate_info(video_db, folder, title, episode_numbers: list, episode_names: list) -> list:
    """既存video(video.db)との重複情報を返す（録画一覧カード/録画詳細の重複表示用）。

    比較キーは確定値の folder(album)/title(series)/episode_number/episode_name
    （放送局=sidは比較しない。同番組の別局録画も重複として拾う）。
    戻り値はvideoの表示用dictのリスト（video.db find_registered_episodesの行、id重複排除）。
    """
    if video_db is None:
        return []
    seen = {}
    n = max(len(episode_numbers), len(episode_names), 1)
    for i in range(n):
        en = _key(episode_numbers[i] if i < len(episode_numbers) else None)
        nm = _key(episode_names[i] if i < len(episode_names) else None)
        if en is None and nm is None:
            continue
        for v in video_db.find_registered_episodes(_at(folder, i), _at(title, i), en, nm):
            seen[v['id']] = v
    return list(seen.values())


def _key(v):
    """話数/話数名の比較キー。未設定は NULL でも '' でも同じ「無し」として扱う
    （video.db は登録経路によって両方が入っている。video_db.find_registered_episodes も
    同様に COALESCE で比較する）。"""
    return None if v is None or str(v) == '' else v


def _norm_category_set(category) -> set:
    """category(list / JSON文字列 / スカラー / None)を名前の集合へ正規化する。"""
    wanted = category
    if isinstance(wanted, str):
        try:
            parsed = json.loads(wanted)
            wanted = parsed if isinstance(parsed, list) else [wanted]
        except (json.JSONDecodeError, ValueError):
            wanted = [wanted]
    return {str(c) for c in (wanted or []) if c}


def check_duplicate_skip(video_db, folder, title, episode_numbers: list,
                         episode_names: list, sid, category=None) -> bool:
    """予約の重複自動スキップ判定(auto_skip_duplicates設定用)。

    True = スキップしてよい。条件(全て必須):
      - 全話数が既存videoと一致(folder/title/episode_number/episode_name + SID一致)。
        SIDも比較する(別局の再放送はスキップしない=安全側。表示用の
        build_duplicate_info とは異なる)
      - 一致した全videoの allow_duplicate が 0(=drop/scrambleなし・放送異常告知なし・
        手動許可なし)。1件でも重複許可(撮り直し歓迎)があればスキップしない
      - category が渡された場合、予約のcategoryが一致video群の実効categoryと交差すること。
        交差しない(=同名別番組扱い)なら別物としてスキップしない(安全側)
      - 話数キーが1つも無い(en/nm両方None)場合は判定不能としてスキップしない
    """
    if video_db is None or sid is None:
        return False
    wanted_cats = _norm_category_set(category)
    n = max(len(episode_numbers), len(episode_names), 1)
    judged = 0
    for i in range(n):
        en = _key(episode_numbers[i] if i < len(episode_numbers) else None)
        nm = _key(episode_names[i] if i < len(episode_names) else None)
        if en is None and nm is None:
            return False  # キー情報の無い話数がある=全話一致を確認できない
        matches = [v for v in video_db.find_registered_episodes(_at(folder, i), _at(title, i), en, nm)
                   if v.get('sid') is not None and str(v.get('sid')) == str(sid)]
        if not matches:
            return False  # この話数は未登録 → 全話重複ではない
        if any(v.get('allow_duplicate') != 0 for v in matches):
            return False  # 重複許可(drop/scramble/告知等)のあるvideoがある → 撮り直す
        if wanted_cats:
            # 予約categoryが一致videoのどれの実効categoryとも交差しなければ別番組扱い→スキップしない
            shared = any(
                wanted_cats & video_db.effective_category_names(
                    v['id'], v.get('series_id'), v.get('album_id'))
                for v in matches)
            if not shared:
                return False
        judged += 1
    return judged > 0
