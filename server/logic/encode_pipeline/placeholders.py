"""出力先のプレースホルダの展開など"""

import json
import os
from datetime import datetime
from typing import Optional
from logic.storage.path_translator import container_to_host
from .base.states import _FMT_EXT, _PLACEHOLDER_RE  # noqa: F401


# ---------------------------------------------------------------------------
# プレースホルダ展開・ユーティリティ
# ---------------------------------------------------------------------------

def _walk_transform(obj, fn):
    """dict/list の全文字列リーフに fn を適用して返す。"""
    if isinstance(obj, dict):
        return {k: _walk_transform(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk_transform(v, fn) for v in obj]
    if isinstance(obj, str):
        return fn(obj)
    return obj


def _substitute_placeholders(obj, recording: dict, idx: int, tmp_dir: str,
                             tmp_base_amz: str = '', tmp_base_host: str = ''):
    """{$key} プレースホルダを recording 値で置換。

    {$tmp_dir} / {$tmp_dirs} : この話数の一時ディレクトリ名（トークン）
    {$tmp_base}              : config.yml の tmp_base を**コンテナから見たパス**に
                               直したもの。encode_preset は Amatsukaze(コンテナ)が
                               読むのでこちらが既定。/host-rootfs 等の前置きも含む
    {$tmp_base_host}         : 同じく tmp_base だがホストのパスそのまま
    """
    def _replace(s: str) -> str:
        def _sub(m):
            key = m.group(1)
            if key in ('tmp_dir', 'tmp_dirs'):
                return str(tmp_dir)
            if key == 'tmp_base':
                return str(tmp_base_amz or tmp_base_host or '')
            if key == 'tmp_base_host':
                return str(tmp_base_host or '')
            v = recording.get(key)
            if v is None:
                return ''
            if isinstance(v, list):
                return str(v[idx]) if idx < len(v) else (str(v[0]) if v else '')
            return str(v)
        return _PLACEHOLDER_RE.sub(_sub, s)
    return _walk_transform(obj, _replace)


def _output_format_to_ext(fmt: str) -> str:
    return _FMT_EXT.get(fmt.upper() if fmt else '', '.ts')


def _get_profile_ext_from_list(profiles: list, profile_name: str) -> str:
    """プロファイル一覧から指定名の出力拡張子を返す。見つからなければ '.ts'。"""
    for p in profiles:
        if p.get('name') == profile_name:
            return _output_format_to_ext(p.get('outputFormat', ''))
    return '.ts'


def _parse_dt(s: str) -> Optional[datetime]:
    """'YYYY-MM-DD-HH:MM:SS.mmm' または ISO 文字列を datetime に変換。"""
    if not s:
        return None
    try:
        return datetime.strptime(s, '%Y-%m-%d-%H:%M:%S.%f')
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _fix_folder_segment(path, folder, fmt):
    """出力パスのフォルダ段を、今の確定値 folder に合わせる。

    確定値の folder が後から直っても app_output_path は追従しないことがある
    （実例: 初回の解析で folder='2' のまま出力パスが確定し、その後 folder が
    'ねこま1/2' に直っても path は '{$encode_dir}/2/...' のままで、別のフォルダへ
    保存されていた）。テンプレートが <encode_dir>/<folder>/<ファイル名> の形の時だけ、
    フォルダ段を今の folder（'/' を全角へ直したパス表記）で置き換える。
    """
    if not path or not folder or not fmt or '/{$folder}/' not in fmt:
        return path
    from text_parser.paths import sanitize_path_component
    want = sanitize_path_component(str(folder))
    head, name = os.path.split(path)
    if not want or not head or os.path.basename(head) == want:
        return path
    return os.path.join(os.path.dirname(head), want, name)


def _list_val(recording: dict, field: str, idx: int):
    """recordings のリスト型フィールドの idx 番目を取得する。"""
    v = recording.get(field)
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                v = parsed
        except Exception:
            pass
    if isinstance(v, list):
        return v[idx] if idx < len(v) else (v[0] if v else None)
    return v


def _get_ei_tag_path(encode_info: dict, amz_vols: list) -> Optional[str]:
    """encode_info から一次ファイルの tag.json パス（app パス）を導出する。"""
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    if not outputs:
        return None
    input_ts_amz = encode_info.get('input_ts', '')
    stem = os.path.splitext(os.path.basename(input_ts_amz))[0]
    if not stem:
        return None
    dst_amz = outputs[0].get('dstPath', '').rstrip('/')
    dst_app = container_to_host(dst_amz, amz_vols)
    if not dst_app:
        return None
    return os.path.join(dst_app, stem + '.tag.json')
