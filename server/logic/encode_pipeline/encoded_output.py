"""エンコードした出力を探す（Amatsukaze のログ・区間の長さ）"""

import glob as _glob
import os
import re
from typing import Optional
from logic.storage.path_translator import container_to_host
from .common import logger


_VIDEO_EXTS = ('.mkv', '.mp4', '.ts', '.m2ts')


def _parse_amz_output_log(log_path: str) -> list:
    """Amatsukaze エンコードログの [出力ファイル] セクションから出力パス(コンテナ)を抽出する。

    ログ例:
        [出力ファイル]
        0: /host-rootfs/.../output/cut-A.mp4
        [入力->出力マッピング]
    """
    out = []
    try:
        with open(log_path, encoding='utf-8', errors='ignore') as f:
            in_sec = False
            for line in f:
                # 実際のログは各行の頭に「AMT [info] 」が付く。これを見出しと取り違えると、
                # [出力ファイル] の次の行で欄が終わったことになり、別名の出力(cut-A.mp4)を
                # 見落として「成果物が無い」と失敗にしていた
                body = re.sub(r'^\s*AMT \[\w+\]\s*', '', line).rstrip()
                if body.startswith('[出力ファイル]'):
                    in_sec = True
                    continue
                if in_sec:
                    # 次のセクション見出し [xxx] で終了
                    if body.startswith('['):
                        break
                    m = re.search(r'(/\S+\.(?:mkv|mp4|ts|m2ts))\s*$', body)
                    if m:
                        out.append(m.group(1))
    except OSError:
        pass
    return out


def _resolve_encoded_output(dst_app: str, stem: str, amz_vols: list,
                            ext: Optional[str] = None) -> Optional[str]:
    """エンコード出力の実ファイル（app パス・非0バイト）を解決する。

    Amatsukaze は出力ファイルを上書きしないため、PC/サーバー再起動後の再実行で
    残骸(0バイトの canonical 名 cut.mp4)を避け、別名(cut-A.mp4 等)に出力することがある。
    canonical(stem+ext) が 0バイト/不在なら、Amatsukaze エンコードログの [出力ファイル]
    セクションを参照して実出力を特定する。
    """
    if not dst_app or not os.path.isdir(dst_app):
        return None
    # 1. canonical（stem そのもの）の非0バイトファイル
    candidates = []
    if ext:
        candidates.append(os.path.join(dst_app, stem + ext))
    else:
        for f in os.listdir(dst_app):
            name, e = os.path.splitext(f)
            if name == stem and e.lower() in _VIDEO_EXTS:
                candidates.append(os.path.join(dst_app, f))
    for c in candidates:
        try:
            if os.path.isfile(c) and os.path.getsize(c) > 0:
                return c
        except OSError:
            pass
    # 2. ログ参照フォールバック（残骸回避で別名出力された場合）。最新ログ優先。
    logs = sorted(_glob.glob(os.path.join(dst_app, '*-enc.log')),
                  key=lambda p: os.path.getmtime(p), reverse=True)
    for log in logs:
        for cont in _parse_amz_output_log(log):
            app = container_to_host(cont, amz_vols)
            try:
                if app and os.path.isfile(app) and os.path.getsize(app) > 0:
                    logger.info('_resolve_encoded_output: ログ参照で実出力を解決: %s (log=%s)',
                                app, os.path.basename(log))
                    return app
            except OSError:
                pass
    return None


def _split_range_total_sec(segments) -> Optional[float]:
    """encodings.segments の split 指定尺（秒）の合計を返す。

    形式: "HH:MM:SS.mmm-HH:MM:SS.mmm"（複数可・",SKIP" 等のタグ付き可）。
    JSON エンコード文字列でも素の文字列でも、時間レンジを正規表現で拾って合計する。
    1つもレンジが無ければ None。
    """
    if not segments:
        return None
    total = 0.0
    found = False
    pat = re.compile(
        r'(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?-(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?'
    )
    for m in pat.finditer(str(segments)):
        sh, sm, ss, sf, eh, em, es, ef = m.groups()
        start = int(sh) * 3600 + int(sm) * 60 + int(ss) + (int(sf.ljust(3, '0')) / 1000 if sf else 0)
        end   = int(eh) * 3600 + int(em) * 60 + int(es) + (int(ef.ljust(3, '0')) / 1000 if ef else 0)
        if end > start:
            total += (end - start)
            found = True
    return total if found else None


def _find_encoded_file(encode_info: dict, amz_vols: list) -> Optional[str]:
    """encode_info から outputs.dstPath 内のエンコード済みファイルパス（app パス）を返す。

    canonical(stem) が 0バイト/不在の場合は Amatsukaze ログの [出力ファイル] を参照する。
    見つからなければ None。
    """
    # アドオンエンコーダーは自分が生成したパスを返しているのでそれを使う
    addon_out = encode_info.get('addon_output_path')
    if addon_out:
        return addon_out if os.path.exists(addon_out) else None
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
    return _resolve_encoded_output(dst_app, stem, amz_vols)
