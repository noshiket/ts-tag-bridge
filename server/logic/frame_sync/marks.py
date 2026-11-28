"""合わせる所の印（チャプター・無音・区間の端）"""

import data_paths
import os
import re
from .refine import _GRID_FPS, _NICE, _SCAN_FRAMES, logger
from .xcorr import nice_kwargs


def chapter_marks(chapter_txt, trim_segments=None):
    """チャプター位置(動画内の秒)を返す。CM解析の無音＋場面の切り替わりから来ている。

    videos.chapter_txt は join_logo_scp の結果で、エンコード後の動画の時間軸で入っている
    (CHAPTER01=00:01:51.979 / CHAPTER01NAME=A10Sec の形)。無音区間の解析から導かれた
    位置なので、そこには必ず場面の切り替わりがある。区間の切れ目(trim_segments)より
    数が多く、1区間しかない動画にも内部の印がある(実測 7/5/12箇所 対 4/1/4箇所)。

    chapter_txt が無ければ trim_segments の切れ目で代用する。
    """
    marks = []
    for line in (chapter_txt or '').splitlines():
        m = re.match(r'CHAPTER\d+=(\d+):(\d+):(\d+(?:\.\d+)?)\s*$', line.strip())
        if m:
            marks.append(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]))
    if marks:
        return sorted(set(marks))
    try:
        durs = [float(s['duration_sec']) for s in (trim_segments or [])]
    except (KeyError, TypeError, ValueError):
        return []
    out, t = [], 0.0
    for d in durs[:-1]:
        t += d
        out.append(t)
    return out


def analyze_mute_marks(path, *, on_log=None, timeout=900, nice=_NICE):
    """無音区間の開始秒を解析して返す（chapter_exe 相当。実測 約25秒/本）。

    chapter_txt が無い動画のための代替。CM解析済みなら chapter_txt や
    cm_analysis.mutes がそのまま使えるので、これを走らせる必要は無い
    (実測では両者で判定結果に差が出なかった。候補が 25箇所 対 7箇所と増えるだけ)。
    """
    import subprocess
    import sys
    import tempfile

    log = on_log or (lambda _m: None)
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'chapter_exe0.txt')
        log(f'無音区間を解析しています: {os.path.basename(path)}')
        try:
            # chapterexe_py は GPL-2.0 のため同梱せず thirdparty/ に置く
            # （thirdparty/install.sh）。import 先に足してから別プロセスで起動する。
            server_dir = data_paths.SERVER_DIR
            env = dict(os.environ)
            tp = os.path.join(server_dir, 'thirdparty')
            env['PYTHONPATH'] = tp + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
            subprocess.run([sys.executable, '-m', 'chapterexe_py',
                            '-v', path, '-o', out, '--quiet'],
                           cwd=server_dir, env=env,
                           capture_output=True, timeout=timeout, check=True,
                           **nice_kwargs(nice))
        except (subprocess.SubprocessError, OSError) as e:
            logger.warning('frame_sync: 無音区間の解析に失敗 %s: %s', path, e)
            return []
        marks = []
        try:
            with open(out, encoding='utf-8', errors='replace') as f:
                for line in f:
                    m = re.match(r'CHAPTER\d+=(\d+):(\d+):(\d+(?:\.\d+)?)\s*$', line.strip())
                    if m:
                        marks.append(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]))
        except OSError:
            return []
    log(f'無音区間 {len(marks)}箇所')
    return sorted(set(marks))


def segment_edge_hints(trim_segments, ranges, *, margin=0.7, chapter_txt=None, marks=None):
    """チャプター位置の直後/直前を、映像判定の候補位置として返す。

    そこには必ず場面の切り替わりがあるので、中央に切り替わりが無い短い区間でも判定できる。
    当てずっぽうに場所を探すより確実で、試行回数も減る。

    marks を直接渡せば(録画の cm_analysis.mutes や再解析した無音区間)それを使う。
    戻り値は verify_video の hints({区間index: [秒,...]})。
    """
    marks = list(marks or []) or chapter_marks(chapter_txt, trim_segments)
    if not marks:
        return {}
    scan = _SCAN_FRAMES / _GRID_FPS
    hints = {}
    for i, r in enumerate(ranges):
        cands = []
        for e in marks:
            for sec in (e + margin, e - margin - scan):     # 印の直後 / 直前
                if r['a_start'] <= sec <= r['a_end'] - scan:
                    cands.append(round(sec, 3))
        if cands:
            hints[i] = cands
    return hints
