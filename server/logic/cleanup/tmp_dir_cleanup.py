"""どの仕事にも使われていない一時フォルダを消す"""

import json
import logging
import os
import re
import shutil

logger = logging.getLogger('logic.cleanup.db_cleanup')   # 片付けのログは1つの名前で出す

# _gen_tmp_name が作る TMP ディレクトリ名（YYYYMMDDhhmm + 英数字6文字）。
# 孤児掃除で fed_ingest / secondary_audio など他用途のディレクトリを消さないための絞り込み。
_TMP_DIR_NAME_RE = re.compile(r'^\d{12}[A-Za-z0-9]{6}$')


def _purge_orphan_tmp_dirs(db, tmp_base: str) -> int:
    """どの encodings からも参照されていない作業ディレクトリを削除する。

    探すのは tmp_base 直下と、録画詳細で直接指定して使った置き場（logic.storage.work_bases が覚えている）。
    誤削除を避けるため、_gen_tmp_dirs が作る命名（YYYYMMDDhhmm + 英数字）に一致し、かつ
    参照されていないものだけを対象にする。tmp_base 以外は録画フォルダなどのこともあるので、
    中身が作業ディレクトリの形（output/ か cut.ts がある）のものに限る。戻り値は削除したディレクトリ数。

    参照元は encodings の入出力先（実際にその作業ディレクトリを使う仕事）を見る。
    recordings.tmp_dirs は全話ぶんのトークンを作成時から持ち続け、エンコード履歴が
    上限で消えたあとも参照ありのままなので、これを基準にすると誰も使わない作業
    ディレクトリを永久に消せない（実測: 44GB が1時間ごとの掃除をすり抜けて居座った）。
    実行中のエンコードは encodings に行があるので消えない。
    """
    from logic.storage import work_bases
    referenced = set()
    for enc in (db.list_encodings() or []):
        try:
            ei = json.loads(enc.get('encode_info') or '{}')
        except (json.JSONDecodeError, TypeError):
            continue
        outputs = ei.get('outputs') or []
        if isinstance(outputs, dict):
            outputs = [outputs]
        dst = (outputs[0].get('dstPath') or '').rstrip('/') if outputs else ''
        if dst:
            referenced.add(os.path.basename(os.path.dirname(dst)))
        # 入力側からも拾う（出力先が未設定の行が残っていても消さないため）
        src = (ei.get('input_ts') or '').rstrip('/')
        if src:
            referenced.add(os.path.basename(os.path.dirname(src)))

    removed = 0
    main_base = (tmp_base or '').rstrip('/')
    for base in work_bases.search_bases(tmp_base):
        need_work_shape = base != main_base
        if not os.path.isdir(base):
            continue
        for name in os.listdir(base):
            if name in referenced or not _TMP_DIR_NAME_RE.match(name):
                continue
            path = os.path.join(base, name)
            if not os.path.isdir(path):
                continue
            if need_work_shape and not (os.path.isdir(os.path.join(path, 'output'))
                                        or os.path.exists(os.path.join(path, 'cut.ts'))):
                continue
            try:
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
                logger.info('cleanup: orphan tmp_dir removed: %s', path)
            except Exception as e:
                logger.warning('cleanup: orphan tmp_dir remove failed: %s: %s', path, e)
    return removed
