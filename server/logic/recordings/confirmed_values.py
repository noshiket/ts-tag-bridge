"""確定値(CONFIRMED VALUES)を text_parser_result へ追従させる共通ロジック。

予約(programs)と録画(recordings)で同じ規約になるよう、判定と書き込み内容を
ここへ集約する（予約の同期の再解析 / POST /rules/<id>/reparse / add_recording の AR3）。

規約:
  上書き(all_fields)   … parser_error が解消した時（未確定だった値が確定した）、
                        または確定値がまだ1つも入っていない時（初回導出）
  追従(changed_fields)  … parser_error の無い元の解析値と、番組情報の更新で導出し直した
                        解析値に違いがある時。古い解析結果のままの列（＝手を入れて
                        いない列）だけ新しい結果へ更新する。新しい解析値は
                        parser_error があっても取れた項目は反映する
  空欄補完(missing_fields) … それ以外。既存値は手動修正の可能性があるため尊重し、
                        空欄と未展開のプレースホルダ('{$folder}' 等)だけ埋める

確定値を無条件に自動上書きしないのは手動修正を守るため
（POST /api/encode/recordings/<id>/reparse の「確定値は変更しない」も同じ理由）。
一方で空欄を放置すると録画の見張りで録画へ空のまま引き継がれ、auto_encode の
require_episode_name/_number ゲートも通らないので補完は行う。

programs と recordings で auto_send の格納形が違う
（programs は INTEGER 1/0、recordings は TEXT 'true'/'false'）ため table で分ける。
"""

import json
import re


# 未展開のプレースホルダ（例: category に '{$folder}' が残る）。解析時に folder が
# 取れず置換できなかった残骸で、確定値としては無効なので補完対象として扱う。
_PLACEHOLDER_RE = re.compile(r'\{\$[A-Za-z_]\w*\}')
# ただし app_output_path(_format) は {$encode_dir}/{$folder} 等をエンコード時に展開する
# 設計のため、プレースホルダが残っているのが正常。
_PLACEHOLDER_OK_COLS = frozenset({'app_output_path', 'app_output_path_format'})


# text_parser の出力キー → DB 列名（else だけ列名が異なる）
_KEY_TO_COL = (
    ('title',                  'title'),
    ('folder',                 'folder'),
    ('episode_name',           'episode_name'),
    ('episode_number',         'episode_number'),
    ('category',               'category'),
    ('furigana',               'furigana'),
    ('else',                   'else_info'),
    ('app_output_path',        'app_output_path'),
    ('app_output_path_format', 'app_output_path_format'),
    ('setting',                'setting'),
)


def is_empty(v) -> bool:
    """確定値が未設定か。

    行の取得元によってリスト列は Python list（_row_to_dict 経由）と
    JSON 配列文字列（get_recordings は素の dict）の両方があるため両対応する。
    0 / False は「値がある」として扱う（未設定は None）。
    """
    if v is None:
        return True
    if isinstance(v, list):
        return all(x is None or (isinstance(x, str) and x.strip() == '') for x in v)
    if isinstance(v, str):
        s = v.strip()
        if s in ('', '[]'):
            return True
        if s.startswith('['):
            try:
                return is_empty(json.loads(s))
            except (json.JSONDecodeError, ValueError):
                return False
    return False


def _s(v):
    if v is None:
        return None
    if isinstance(v, list):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def _cmp(v):
    """比較用の正規化。

    リスト列の確定値は list（行の取得元によっては JSON 配列文字列）で返るのに、
    解析結果は単話ならスカラーで来る。そのまま比べると必ず不一致になり、
    changed_fields の「確定値が古い解析結果のまま＝手を入れていない」判定が
    永久に成立せず、番組情報が更新されても確定値が追従しなくなる。
    1要素のリストは中身と同じものとして比べる（2件以上はそのまま比較）。
    """
    if isinstance(v, str):
        t = v.strip()
        if t.startswith('['):
            try:
                v = json.loads(t)
            except (json.JSONDecodeError, ValueError):
                return t
    if isinstance(v, list) and len(v) == 1:
        v = v[0]
    return _s(v)


def _has_placeholder(v) -> bool:
    if isinstance(v, list):
        return any(_has_placeholder(x) for x in v)
    return isinstance(v, str) and bool(_PLACEHOLDER_RE.search(v))


def needs_fill(col: str, v) -> bool:
    """その列を解析結果で埋め直すべきか（空欄 or 未展開のプレースホルダが残っている）。"""
    if is_empty(v):
        return True
    return col not in _PLACEHOLDER_OK_COLS and _has_placeholder(v)


def should_overwrite(row: dict, had_error: bool, has_error: bool) -> bool:
    """確定値を解析結果で上書きしてよいか（True=all_fields / False=missing_fields）。

    had_error / has_error は再解析の前後の parser_error の有無。
      ・解消した            → 上書き（エラー中の確定値は未確定扱い＝古い値ごと更新する）
      ・確定値が全て空       → 上書き（初回導出。実質 missing_fields と同じ結果）
      ・それ以外            → 上書きしない（空欄補完のみ）
    """
    if had_error and not has_error:
        return True
    return (row.get('auto_send') is None
            and all(is_empty(row.get(col)) for _, col in _KEY_TO_COL))


def changed_fields(row: dict, old_tp: dict, new_tp: dict, table: str) -> dict:
    """番組情報の更新で解析結果が変わった時に、確定値へ反映する更新 dict を返す。

    予約直後の暫定EPGで別のパターンに当たり、後から正しいパターンへ変わることがある
    （例: 初回「炎の球技女　ボール子」→ 更新後「炎の球技児」）。解析結果だけ新しく
    しても確定値が古いままだと、そのまま録画・重複判定に使われてしまう。

    手動修正は守るため、更新するのは「確定値が古い解析結果のままの列」だけにする
    （＝自動で入った値だと分かる列）。空欄・未展開プレースホルダは missing_fields
    と同じく埋める。

    呼び出し側は old_tp が parser_error の無い解析値である時だけ使うこと
    （エラー中の解析値は未確定なので差分の意味がない）。new_tp 側は parser_error が
    あっても構わない — 取れなかった項目は空なのでここで弾かれる。
    """
    if not row or not new_tp:
        return {}
    fields = {}
    for key, col in _KEY_TO_COL:
        new = new_tp.get(key)
        if is_empty(new) or (col not in _PLACEHOLDER_OK_COLS and _has_placeholder(new)):
            continue
        old = (old_tp or {}).get(key)
        cur = row.get(col)
        # 確定値(リスト)と解析結果(単話はスカラー)を突き合わせるため正規化して比べる
        if _cmp(new) == _cmp(cur):
            continue                      # 既に新しい値
        if needs_fill(col, cur):
            fields[col] = _s(new)         # 空欄/プレースホルダ → 埋める
        elif old is not None and _cmp(cur) == _cmp(old):
            fields[col] = _s(new)         # 古い解析結果のまま = 手を入れていない
    return fields


