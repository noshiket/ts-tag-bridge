"""エンコードの作業フォルダ（作り直す・出力先と tag.json・元の TS をつなぐ・次の場所へ移す）"""

import json
import os
import shutil
from logic.storage.path_translator import container_to_host, host_to_container
from .common import logger
from .base.tmp_dir import _clear_tmp_dir
from .base.disk import free_bytes
from .placeholders import _get_ei_tag_path
from .tag_json import _write_tag_json


def _reset_tmp_dir(db, enc: dict, encode_info: dict, amz_vols: list) -> None:
    """split_ts の初回処理で当該エンコードの tmp 作業ディレクトリを削除して作り直す（_clear_tmp_dir）。

    前回（失敗含む）の cut.ts / output（amt_dir・エンコード済みファイル・tag.json）を
    一掃してクリーンに再分割するため。
    """
    _clear_tmp_dir(db, enc, encode_info, amz_vols, recreate=True, who='_reset_tmp_dir')


def _prepare_encode_dirs_and_tag(db, enc: dict, encode_info: dict, amz_vols: list) -> None:
    """各エンコードの初回処理: 出力ディレクトリ作成 + 初期 tag.json 書き出し。

    旧 run_make_db が全話分まとめて行っていた処理を、encodings 単位の初回
    （run_split_ts 冒頭）に移したもの。tag.json が既存なら上書きしない。
    """
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    for out in outputs:
        dst_amz = out.get('dstPath', '')
        dst_app = container_to_host(dst_amz, amz_vols)
        os.makedirs(dst_app or dst_amz, exist_ok=True)

    ei_tag = _get_ei_tag_path(encode_info, amz_vols)
    if ei_tag and not os.path.exists(ei_tag):
        recording = db.get_recording(enc['recording_id'])
        if recording:
            rec_for_tag = dict(recording)
            segs_raw = rec_for_tag.get('segments')
            if isinstance(segs_raw, str):
                try:
                    rec_for_tag['segments'] = json.loads(segs_raw)
                except Exception:
                    pass
            _write_tag_json(ei_tag, rec_for_tag, enc.get('episode_idx', 0) or 0)
            logger.info('_prepare_encode_dirs_and_tag: enc_id=%d tag.json created: %s',
                        enc['id'], ei_tag)


def _link_source_ts(src: str, dst: str) -> str:
    """cut.ts をソースTSへのリンクにする。コピーは最後の手段。

    trim モードは元TSを丸ごと入力にするので、話ごとに実体を持つ必要はない。
    パスだけ話ごとに分かれていればよい（Amatsukaze が読む {SrcPath}.trim.avs が
    ぶつからないようにするため）。

    ハードリンクは同じファイルシステムでないと張れず、録画置き場と tmp が別
    ディスクなら必ず失敗する。そこをコピーへ落としていたため、5時間23GBの録画を
    12話に分けると 12×23GB がtmpに積まれ、ディスクを埋め切っていた。

    代わりに**相対**シンボリックリンクを張る。Amatsukaze コンテナはホストの / を
    /host-rootfs に持つので、絶対パスのリンクはコンテナ内で解決先が外れるが、
    相対パスならホストからもコンテナからも同じ実体に届く。

    戻り値: 'hardlink' / 'symlink' / 'copy'
    """
    try:
        os.link(src, dst)
        return 'hardlink'
    except OSError:
        pass
    try:
        rel = os.path.relpath(os.path.realpath(src),
                              os.path.dirname(os.path.abspath(dst)))
        os.symlink(rel, dst)
        # 実体に届くことを確かめる（届かないリンクを置いたままにしない）
        if os.path.getsize(dst) == os.path.getsize(src):
            return 'symlink'
        os.unlink(dst)
    except OSError as e:
        logger.info('_link_source_ts: symlink不可(%s)', e)
        if os.path.islink(dst):
            os.unlink(dst)
    shutil.copy2(src, dst)
    return 'copy'


def _move_to_next_tmp_base(db, enc: dict, encode_info: dict, amz_vols: list, tmp_dir_app: str,
                           need: int, free: int, config: dict) -> bool:
    """作業ディレクトリの空きが足りない時、候補(tmp_base_list)の次で空きのある所へ移す。

    encode_info の input_ts / outputs.dstPath（と行の tag_json）の作業ディレクトリ部分を
    書き換えて保存する。移した先は掃除が探せるよう覚えておく。移せたら True。
    元が候補の外（録画詳細で直接指定した場所）でも、候補に空きがあればそちらへ移す。
    """
    from logic.storage import work_bases
    if not config:
        return False
    cur_base = os.path.dirname(tmp_dir_app.rstrip('/'))
    token = os.path.basename(tmp_dir_app.rstrip('/'))
    bases = work_bases.tmp_bases(config)
    for base in bases:
        if base.rstrip('/') == cur_base.rstrip('/') or not os.path.isdir(base):
            continue
        try:
            base_free = free_bytes(base)
        except OSError:
            continue
        if base_free < need:
            continue
        new_dir_app = os.path.join(base, token)
        old_amz = host_to_container(tmp_dir_app, amz_vols).rstrip('/')
        new_amz = host_to_container(new_dir_app, amz_vols).rstrip('/')

        def _rebase(v):
            return new_amz + v[len(old_amz):] if isinstance(v, str) and (v == old_amz or v.startswith(old_amz + '/')) else v
        encode_info['input_ts'] = _rebase(encode_info.get('input_ts'))
        outputs = encode_info.get('outputs')
        for out in (outputs if isinstance(outputs, list) else [outputs] if isinstance(outputs, dict) else []):
            if isinstance(out, dict) and 'dstPath' in out:
                out['dstPath'] = _rebase(out['dstPath'])
        upd = {'encode_info': json.dumps(encode_info, ensure_ascii=False)}
        tj = enc.get('tag_json')
        if isinstance(tj, str) and tj.startswith(tmp_dir_app.rstrip('/') + '/'):
            upd['tag_json'] = enc['tag_json'] = new_dir_app + tj[len(tmp_dir_app.rstrip('/')):]
        db.update_encoding(enc['id'], **upd)
        enc['encode_info'] = upd['encode_info']
        # 前の作業ディレクトリに古い分が残っていれば消す（このエンコード専用の名前）
        if os.path.isdir(tmp_dir_app):
            shutil.rmtree(tmp_dir_app, ignore_errors=True)
        work_bases.remember(base, bases[0] if bases else '')
        logger.info('run_split_ts: enc_id=%d 作業ディレクトリの空き不足（必要 %.1fGB / 空き %.1fGB）→ %s へ移しました',
                    enc['id'], need / 1024 ** 3, free / 1024 ** 3, new_dir_app)
        return True
    return False
