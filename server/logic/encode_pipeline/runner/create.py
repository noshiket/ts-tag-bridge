"""エンコードの行を作る（エンコードできるかの確かめ・アドオンのジョブ）"""

import json
import threading as _threading
from typing import Optional
from ..common import (  # noqa: F401
    logger,
)
from ..base.context import _addon_encoder_name, _resolve_encode_context, _update_recording_rollup
from ..step_make_db import (  # noqa: F401
    run_make_db,
)
from .transfer_cleanup import _delete_tmp_dirs_physical, _notify_encoding_started  # noqa: F401


def _ensure_tmp_dirs(db, recording_id: int, recording: dict, ctx: dict) -> None:
    """make_DB のタイミングで segments の件数に合わせて recordings.tmp_dirs を整える。

    tmp_dirs は元々 add_recording 時に episode_number/name の件数で生成されるが、
    詳細画面で segments を編集して話数が変わると件数がズレる。make_DB（エンコード
    キュー追加）の時点で segments を正として件数を合わせる。
    既に件数一致かつ全要素が非空なら既存を再利用する（再分割は run_split_ts 冒頭の
    _reset_tmp_dir が tmp を掃除して行う）。不一致で再生成する場合は、旧トークンの
    物理 tmp ディレクトリを削除してオーファンを防ぐ。
    """
    from logic.add_recording.helpers import _gen_tmp_dirs

    segs = recording.get('segments')
    seg_list = json.loads(segs) if isinstance(segs, str) else segs
    count = len(seg_list) if isinstance(seg_list, list) and seg_list else 1

    existing = recording.get('tmp_dirs')
    existing = json.loads(existing) if isinstance(existing, str) else (existing or [])
    if isinstance(existing, list) and len(existing) == count and all(existing):
        return

    # 再生成: 旧 tmp ディレクトリを物理削除してから新規トークンを登録
    if isinstance(existing, list) and existing:
        _delete_tmp_dirs_physical(existing, ctx)

    tmp_dirs = _gen_tmp_dirs(count)
    db.update_recording(recording_id, tmp_dirs=json.dumps(tmp_dirs, ensure_ascii=False))
    logger.info('_ensure_tmp_dirs: recording_id=%d tmp_dirs regenerated to match %d segments (was %d)',
                recording_id, count, len(existing) if isinstance(existing, list) else 0)


# create_encodings(make_DB)の直列化ロック。複数録画を一気にキュー投入すると
# queue_recording がリクエスト毎にスレッドを起こし、_ensure_tmp_dirs のtmp削除(ディスクI/O)
# や重複チェック・DB書き込みが並走してAPI応答が悪化するため、1本ずつ実行する
_MAKE_DB_LOCK = _threading.Lock()


def _confirmed_present(v) -> bool:
    """確定値(list / JSON配列文字列 / スカラー)が実質的に埋まっているか。
    複数話はリストになるため、全要素が空なら未設定とみなす。"""
    if isinstance(v, str) and v.startswith('['):
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                v = parsed
        except (json.JSONDecodeError, ValueError):
            pass
    if isinstance(v, list):
        return any(x not in (None, '') for x in v)
    return v not in (None, '')


def check_encodable(recording: dict) -> Optional[str]:
    """エンコードキューへ載せられない理由を返す（載せてよければ None）。

    - folder / title の確定値が未設定 … 出力パスが解決できないままエンコードしても
      置き場所が決まらないので待たせる
    - 分割結果が全て SKIP … エンコードすべき話が1つも無い（全話が登録済み video と重複）
    - 出力先（app_output_path）の確定値が無い話がある … 最後のコピーで必ず失敗する

    手動キュー投入(queue/requeue)と自動投入(録画の走査)の両方から呼び、
    どちらの経路でも state=waiting のまま止める。
    """
    for key in ('folder', 'title'):
        if not _confirmed_present(recording.get(key)):
            return f'{key} の確定値が未設定です'

    segs = recording.get('segments')
    if isinstance(segs, str):
        try:
            segs = json.loads(segs)
        except (json.JSONDecodeError, TypeError):
            segs = None
    if isinstance(segs, list) and segs and all(
            isinstance(s, str) and ',SKIP' in s for s in segs):
        n = len(segs)
        return (f'全{n}話とも SKIP（登録済みの動画と重複）のため出力する話がありません。'
                f'エンコードするなら分割画面で SKIP を解除してください')
    # 出力先が無いとエンコードしても最後のコピーで必ず失敗する（エンコードが無駄になる）
    from ..output_check import output_missing_reason
    return output_missing_reason(recording)


def create_encodings(db, recording_id: int, config: dict) -> None:
    """「エンコードキューに追加」の初期処理。

    既存 encodings を削除し make_DB（行作成のみ）で作り直す。各行は state=wait_encode。
    その後 recordings.state を rollup（通常 'queued'）に更新する。
    出力ディレクトリ作成・初期 tag.json 書き出しは各エンコードの初回（run_split_ts）で行う。
    同時投入に備えプロセス内で直列化する(_MAKE_DB_LOCK)。
    """
    with _MAKE_DB_LOCK:
        _create_encodings_locked(db, recording_id, config)
    # キュー投入通知はネットワーク待ちがあるためロック外で行う
    recording = db.get_recording(recording_id)
    if recording and db.get_encodings(recording_id):
        _notify_encoding_started(recording, config)


def _create_encodings_locked(db, recording_id: int, config: dict) -> None:
    recording = db.get_recording(recording_id)
    if not recording:
        raise ValueError(f'recording_id={recording_id} not found')

    ctx = _resolve_encode_context(recording, config)
    if ctx is None:
        db.update_recording(recording_id, state='error', error_message='to_encode_info not set')
        raise ValueError(f'recordings.to_encode_info not set for recording_id={recording_id}')
    if ctx['encode_type'] != 'amatsukaze_servers' and not _addon_encoder_name(ctx['encode_type']):
        # 非対応をqueuedのまま放置すると「キューに載ったのに何も起きない」状態になるため
        # errorで可視化する(従来はwarningログのみで無言return)
        msg = f'非対応の encode_type です: {ctx["encode_type"]!r}'
        logger.warning('create_encodings: %s (recording_id=%d)', msg, recording_id)
        db.update_recording(recording_id, state='error', error_message=msg)
        return

    # segments の件数に合わせて tmp_dirs を整える（不一致時は旧 tmp を削除して再生成）。
    # 更新を反映するため recording / ctx を取り直す。
    _ensure_tmp_dirs(db, recording_id, recording, ctx)
    recording = db.get_recording(recording_id)
    ctx = _resolve_encode_context(recording, config)

    if not ctx['tmp_dirs']:
        raise ValueError(f'recordings.tmp_dirs empty for recording_id={recording_id}')

    run_make_db(db, recording_id, recording, ctx['tmp_dirs'],
                ctx['encode_preset_tpl'], ctx['amz_vols'], ctx['encode_dir'],
                config.get('tmp_base', ''), config)
    if not db.get_encodings(recording_id):
        # 全話SKIP(登録済みvideoと重複等)でencodingsが0件 → rollupは何もしないため、
        # queuedのまま残らないよう完了扱いにする
        db.update_recording(recording_id, state='encode_finish')
        logger.info('create_encodings: recording_id=%d 全話SKIPのためencode_finish', recording_id)
        return
    _update_recording_rollup(db, recording_id)
    logger.info('create_encodings: recording_id=%d encodings created', recording_id)
