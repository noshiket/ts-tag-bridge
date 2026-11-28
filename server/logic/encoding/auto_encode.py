"""auto_encode — 確定値マッチで recordings.auto_send を true にするルール評価。

auto_encode テーブルの各ルールは、登録時に recordings の確定値
（folder / title / sid）をスナップショットして作られる。録画の確定値が
有効ルールのいずれかにマッチしたら auto_send='true' をセットする（true にするだけ）。

ルールのフラグ:
  use_folder / use_title / use_sid          : その確定値の一致を照合条件に使う
  require_episode_name / _episode_number    : 確定値が存在する場合のみ実行
  allow_multi_episode                       : 複数話でも実行する
"""

from logic.recordings.episode_check import is_multi_episode


def _present(v) -> bool:
    """確定値（文字列 or リスト）が非空かどうか。"""
    if isinstance(v, list):
        return any(x not in (None, '') for x in v)
    return v not in (None, '')


def _norm(v) -> str:
    """確定値（文字列 or リスト）を比較用文字列へ正規化する（list は ', ' 連結）。
    録画側は list、ルール側（auto_encode テーブル）は文字列でも一致するようにする。"""
    if isinstance(v, list):
        return ', '.join('' if x is None else str(x) for x in v)
    return '' if v is None else str(v)


def _is_multi(ep) -> bool:
    if isinstance(ep, list):
        return len([x for x in ep if x not in (None, '')]) >= 2
    return is_multi_episode(ep)


def _matches(recording: dict, rule: dict) -> bool:
    # 一致条件（条件1/2/6）。有効な一致条件が1つもなければマッチさせない。
    use_any = False
    if rule.get('use_folder'):
        use_any = True
        if _norm(recording.get('folder')) != _norm(rule.get('folder')):
            return False
    if rule.get('use_title'):
        use_any = True
        if _norm(recording.get('title')) != _norm(rule.get('title')):
            return False
    if rule.get('use_sid'):
        use_any = True
        if recording.get('sid') != rule.get('sid'):
            return False
    if not use_any:
        return False
    # 存在ゲート（条件3/4）
    if rule.get('require_episode_name') and not _present(recording.get('episode_name')):
        return False
    if rule.get('require_episode_number') and not _present(recording.get('episode_number')):
        return False
    # 複数話ゲート（条件5）
    if not rule.get('allow_multi_episode') and _is_multi(recording.get('episode_number')):
        return False
    return True


def match_auto_encode(recording: dict, rules: list) -> bool:
    """recording の確定値が有効ルールのいずれかにマッチすれば True。"""
    for rule in rules:
        if not rule.get('enabled'):
            continue
        if _matches(recording, rule):
            return True
    return False


def auto_send_priority(value) -> int:
    """auto_send確定値をエンコード優先度(0-5)へ正規化する。

    0 / false / null / その他の値 = 自動エンコードしない(0)。
    true = 3(既定優先度)。1〜5の数値 = その優先度(6以上は5に丸め)。
    """
    if value is None:
        return 0
    if isinstance(value, bool):
        return 3 if value else 0
    s = str(value).strip().lower()
    if s == 'true':
        return 3
    try:
        n = int(float(s))
    except (TypeError, ValueError):
        return 0
    return min(5, n) if n >= 1 else 0


def apply_to_recording(db, recording: dict) -> bool:
    """recording がルールにマッチしたら auto_send='true'(=優先度3) を DB に書き込む。

    書き込んだ場合 True。既に有効(true/1〜5) / 非マッチは False
    （auto_send を false にはしない）。recording dict はインプレースで更新する。
    """
    if auto_send_priority(recording.get('auto_send')) > 0:
        return False
    # parser_error がある確定値は auto_send=true にしない
    if recording.get('parser_error'):
        return False
    # EIT放送時間との重なりが浅い（録画が途中で切れている疑い）は auto_send=true にしない。
    # 算出不能（None）は overlap では弾かない。
    overlap = recording.get('eit_overlap')
    if overlap is not None and overlap <= 0.9:
        return False
    rules = db.list_auto_encode(enabled_only=True)
    if not match_auto_encode(recording, rules):
        return False
    db.update_recording(recording['id'], auto_send='true')
    recording['auto_send'] = 'true'
    return True
