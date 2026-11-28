"""epg_auto_add — EPG自動予約ルールとのマッチング（予約の同期 / API 共用）"""

import re as _re
import unicodedata as _uc


def comment_key_of(comment: str) -> str | None:
    """予約の comment から EPG自動予約のキーワードを取る。'EPG自動予約' だけなら ''、EPG自動予約でなければ None。"""
    m = _re.match(r'^EPG自動予約\((.+)\)$', comment)
    if m:
        return _uc.normalize('NFKC', m.group(1))
    return '' if comment == 'EPG自動予約' else None


def keys_match(program: dict, comment_key: str, and_key: str, not_key: str,
               title_only: bool, reg_exp: bool, svc_list: list) -> bool:
    """1つのルールの andKey・notKey・serviceList が番組に合うか（予約の同期と API の候補で共用）。

    comment_key（予約の comment のキーワード）と andKey が一致するルールだけを当てる。
    """
    rule_key = _uc.normalize('NFKC', and_key or '')
    if rule_key != comment_key:
        return False
    parts = (program.get('reserve_key', '') or '').split('-')
    sid = int(parts[2]) if len(parts) == 4 else None
    title = program.get('original_title', '') or ''
    desc = program.get('original_description', '') or ''
    target = title if title_only else f'{title} {desc}'.strip()

    if rule_key:
        if reg_exp:
            try:
                if not _re.search(rule_key, target):
                    return False
            except _re.error:
                return False
        elif not all(w in target for w in rule_key.split()):
            return False

    if not_key:
        if reg_exp:
            try:
                if _re.search(not_key, target):
                    return False
            except _re.error:
                pass
        elif any(w in target for w in not_key.split()):
            return False

    if svc_list and sid is not None:
        if sid not in [sv.get('sid') for sv in svc_list if isinstance(sv, dict)]:
            return False
    return True


def find_auto_add_id(program: dict, comment: str, raw_rules: list) -> int | None:
    """
    予約の comment と EDCB auto_add 生データからマッチする auto_add_id を決定する。

    Args:
        program:   programs テーブルの dict（reserve_key, original_title, original_description）
        comment:   EDCB 予約の comment フィールド
        raw_rules: edcb.enum_auto_add() の生データリスト

    Returns:
        int:  候補が1件に絞れた場合の dataID
        0:    EPG自動予約コメントでない（確定）→ センチネル
        None: 候補が0件または複数（未確定）
    """
    comment_key = comment_key_of(comment)
    if comment_key is None:
        return 0  # EPG自動予約でない → センチネル
    candidates = []
    for raw in raw_rules:
        s = raw.get('searchInfo', {})
        if keys_match(program, comment_key, s.get('andKey', ''), s.get('notKey', '') or '',
                      bool(s.get('titleOnlyFlag', False)), bool(s.get('regExpFlag', False)),
                      s.get('serviceList', []) or []):
            candidates.append(raw['dataID'])

    if len(candidates) == 1:
        return candidates[0]
    return None  # 未確定（0件または複数）
