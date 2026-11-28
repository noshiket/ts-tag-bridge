"""Step 5: file_copy"""

import json
import os
from typing import Optional
from .file_copy_steps import _copy_or_reason, _record_recording_device, _resolve_encode_dir, _update_source_tag
from .library_push import _push_master_direct, _push_to_library, _register_local_video, _remove_pushed_files
from .common import (  # noqa: F401
    FED_MASTER,
    _apply_encode_dir,
    logger,
)


# ===========================================================================
# Step 5: run_file_copy
# ===========================================================================

_shoboi_fetcher = None


def fetch_announce_by_sid(sid, start_time) -> Optional[str]:
    """しょぼいカレンダーの放送異常告知(sid-announce)を sid + eit_start_time で取得する。

    テロップ・繰り下げ等の告知情報。'テロップ'/'気象情報テロップ' 等=あり、
    'none(...)'=なし。best-effort(取得失敗/条件不足は None)。
    """
    global _shoboi_fetcher
    if not sid or not start_time:
        return None
    try:
        if _shoboi_fetcher is None:
            from text_parser.fetchers.core import ShoboiInfoFetcher
            _shoboi_fetcher = ShoboiInfoFetcher()
        info = _shoboi_fetcher.get_all_info_from_sid_and_time(int(sid), str(start_time))
        return (info or {}).get('sid-announce')
    except Exception as e:
        logger.warning('fetch_announce_by_sid: sid=%s failed: %s', sid, e)
        return None


def _fetch_announce(enc: dict) -> Optional[str]:
    """encoded_analyze 用: enc の sid + eit_start_time で放送異常告知を取得する。"""
    return fetch_announce_by_sid(enc.get('sid'), enc.get('eit_start_time'))


def _telop_announce(captions2_json) -> Optional[str]:
    """文字スーパー(地震速報等のテロップ)が実際に流れていれば announce 用の文字列を返す。

    ts_scanner が2本目の字幕枠へ入れた文字スーパー(kind='superimpose')を見る。
    しょぼいカレンダーに告知が無い時の実測フォールバック。
    """
    if not captions2_json:
        return None
    try:
        data = json.loads(captions2_json) if isinstance(captions2_json, str) else captions2_json
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict) or data.get('kind') != 'superimpose':
        return None
    return 'テロップ放送' if (data.get('captions') or []) else None


def run_file_copy(db, enc: dict, amz_vols: list, client, config: dict = None) -> bool:
    """
    エンコード済みファイルを outputs.dstPath → app_output_path にコピーする。
    コピー前に recording_device を取得し、app_output_path_format を置換、tag.json に反映する。
    割当先 encode_dir のディスクが取り外し中なら encode_dir_list 優先順で代替先へ切り替える。
    失敗時は state=file_copy のまま error_message を更新し False を返す。
    """
    enc_id = enc['id']
    db.update_encoding(enc_id, state='file_copy')

    if enc.get('encode_dir') == FED_MASTER and _push_master_direct(db, enc, amz_vols, client, config):
        return True

    # --- encode_dir フォールバック: 割当先ディスクが取り外し中なら代替先へ切替 ---
    # is_master は後段の federation push 判定でも使うため関数スコープで保持する。
    encode_dir = enc.get('encode_dir')
    is_master = (encode_dir == FED_MASTER)
    if not _resolve_encode_dir(db, enc, config):
        return False

    # --- recording_device 取得 & app_output_path_format 置換 ---
    app_output_path = _apply_encode_dir(enc.get('app_output_path'), enc.get('encode_dir'))

    # フォールバック時はサムネ最終パスを新 encode_dir 基準に更新（DB / tag.json）
    new_thumb = new_tile = None
    if app_output_path and enc.get('encode_dir') != encode_dir:
        _app_stem = os.path.splitext(app_output_path)[0]
        upd = {}
        if enc.get('thumbnail_path'):
            new_thumb = _app_stem + '.thumbnail.webp'
            upd['thumbnail_path'] = new_thumb
        if enc.get('thumbnail_tile_path'):
            new_tile = _app_stem + '.thumbnail_tile.webp'
            upd['thumbnail_tile_path'] = new_tile
        if upd:
            db.update_encoding(enc_id, **upd)

    encode_info = json.loads(enc.get('encode_info') or '{}')
    if app_output_path:
        mount_dir, fmt = _record_recording_device(db, enc, app_output_path)
        # コピー前にソース側 tag.json を更新（recording_device / app_output_path_format）
        _update_source_tag(enc, encode_info, amz_vols, app_output_path, mount_dir, fmt, new_thumb, new_tile)

    copy_err = _copy_or_reason(enc, encode_info, amz_vols, client)
    if copy_err:
        db.update_encoding(enc_id, error_message=copy_err)
        return False

    tag_dst = (app_output_path + '.tag.json') if app_output_path else None

    # federation: encode_dir==FED_MASTER のエンコードだけ、ローカル登録の代わりに
    # ライブラリサーバーへ push する（best-effort。失敗すれば従来どおりローカル登録に
    # フォールバックし、必ずどこかで見つかる）。通常のencode_dirを指定したエンコードは
    # 常にローカル保存になる（従来はlibrary_peer設定さえあれば常にpushしていた）。
    fed = (config or {}).get('federation') or {}
    pushed = False
    if is_master and fed.get('library_peer') and tag_dst and os.path.exists(tag_dst):
        pushed = _push_to_library(db, enc, encode_info, fed, tag_dst)

    if pushed:
        _remove_pushed_files(enc_id, tag_dst, app_output_path)
    elif tag_dst and os.path.exists(tag_dst):
        # is_masterでここに来た = push未成立でローカル登録に確定した状態。ここで初めて
        # encode_dirを実パスへ永続化する(pushが最終的に成功しなかったことが確定してから
        # 書き込むことで、pushを試す前の失敗ではmaster指定を保持し、次回リトライで
        # 再度pushが試みられるようにする)。
        if is_master and enc.get('encode_dir') != encode_dir:
            db.update_encoding(enc_id, encode_dir=enc.get('encode_dir'))
        _register_local_video(enc, tag_dst)

    logger.debug('run_file_copy: enc_id=%d complete', enc_id)
    return True
