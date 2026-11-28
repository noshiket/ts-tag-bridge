"""CM 解析の結果を読む（場面・チャプター・TOT の対応・最初の PTS に合わせる）"""

import data_paths
import math
import os
import re


def _tot_mapper(vpts, tot_entries):
    """フレーム番号 → 放送の実時刻(TOT) を返す関数を作る。

    トリムや分割をすると相対時刻(先頭からの秒)は動くが、放送の実時刻は動かない。
    音声と映像で開始位置が違うのも実時刻なら関係ない。あとで別の動画へ位置を
    持ち越すときはこれが唯一の共通の基準になるので、秒と一緒に持たせておく。

    TOT は frame_index が映像と同じ1パスで拾っている(30分番組で 300〜400 件)。
    """
    from read_tsprogram.tot import interpolate_tot_for_pts

    if not tot_entries or not vpts:
        return lambda _n: None

    def at(n):
        if n is None:
            return None
        i = 0 if n < 0 else (len(vpts) - 1 if n >= len(vpts) else int(n))
        t = interpolate_tot_for_pts(tot_entries, vpts[i])
        return t.isoformat(timespec='milliseconds') if t else None

    return at


def parse_scenes_all_file(path, t_at):
    """chapterexe が出す「切り替わり全部」を読む。[{frame, sec, score}]

    chapter_exe が出す SCPos は1つの無音につき1箇所だけで、5フレーム以内
    (SPACE_SC1) は畳み、弱いものはしきい値で落とす。実測の無音
    [62973,63001] のまわりは 62975/62977/62979/62981/62986 が切り替わって
    いるのに、出るのは 62977 だけだった。分割画面の▼は全部へ飛びたい。

    無ければ空（古い解析結果や、まだ作り直していない録画）。
    """
    out = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                a = line.split()
                if len(a) >= 2 and a[0].isdigit():
                    fr = int(a[0])
                    out.append({'frame': fr, 'sec': t_at(fr), 'score': float(a[1])})
    except OSError:
        return []
    return out


def parse_chapter_file(path, fps, t_at, tot_at=None):
    """chapter_exe0.txt から無音区間とシーンチェンジ位置を読む。

    形式は原典 chapter_exe の出力そのままで、2行1組。
      CHAPTER01=00:00:05.505              ← 無音の開始位置
      CHAPTER01NAME=53フレーム ＿ SCPos:196 195
                     ↑無音の長さ  ↑印   ↑シーンチェンジ位置(と1つ前)

    印は ＿(通常) / ★★(静止画) / ＠(強制) など。原典の記号をそのまま持つ。
    フレーム番号は chapter_exe の時刻(=フレーム/fps)から戻し、秒は t_at で
    フレーム表のPTSから出し直す（プレイヤーの時刻と基準を揃えるため）。
    戻り値: (mutes, scenes)
    """
    mutes, scenes = [], []
    tot_at = tot_at or (lambda _n: None)
    start = None
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.rstrip('\n')
            m = re.match(r'CHAPTER\d+=(\d+):(\d+):(\d+(?:\.\d+)?)$', line)
            if m:
                start = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
                continue
            m = re.match(r'CHAPTER\d+NAME=(\d+)フレーム\s*(\S*)\s*SCPos:(\d+)\s+(\d+)', line)
            if m and start is not None:
                n = int(m[1])
                mark = m[2] if not m[2].startswith('SCPos') else ''
                sf = int(round(start * fps))
                mutes.append({'start': t_at(sf),
                              'end': t_at(sf + n),
                              'start_frame': sf, 'frames': n,
                              # 無音の頭は絵が変わらない。飛び先に使うのは
                              # 同じ行の SCPos（この無音の中の切り替え位置）。
                              # 実測: 無音の頭 32498 は前との変化量
                              # 0.72（まわりと同じ）、SCPos 32523 で 86.63。
                              'scene_frame': int(m[3]),
                              'scene_sec': t_at(int(m[3])),
                              'tot': tot_at(sf)})
                scenes.append({'frame': int(m[3]), 'prev_frame': int(m[4]),
                               'sec': t_at(int(m[3])), 'mark': mark,
                               'tot': tot_at(int(m[3]))})
                start = None
    return mutes, scenes


def align_to_first_pts(result, rec_id, ts_path):
    """古い解析結果の秒を first_pts 基準（プレイヤーの再生時刻）へ寄せる。

    'time_base' が無い結果は フレーム番号÷fps で秒を出しており、原点がフレーム表の
    先頭フレーム(vpts[0])になっている。アプリの再生時刻・トリム・フレーム番号変換は
    first_pts(TS先頭付近の映像PESのPTS最小値)が原点で、先頭にフレーム表へ載らない
    ピクチャがある録画ではその差ぶん解析結果だけ前にずれる（実測 23本中18本、5〜34フレーム）。

    各要素はフレーム番号を持っているので、フレーム表からPTSを引いて秒を出し直す。
    フレーム表か TS が無ければそのまま返す（再解析すれば直る。壊れた値は作らない）。
    """
    if not isinstance(result, dict) or result.get('time_base') == 'first_pts':
        return result
    try:
        from media.frame_index.table_file import frame_index_path, load_frame_table
        from media.frame_index.lookup import read_first_pts
        data_dir = data_paths.DATA_DIR
        cache = frame_index_path(rec_id, data_dir) if rec_id else None
        if not cache or not os.path.exists(cache) or not ts_path or not os.path.exists(ts_path):
            return result
        frames, _fp = load_frame_table(cache)
        first_pts = read_first_pts(ts_path)
    except Exception:
        return result

    n = len(frames)
    off = (frames[0] - first_pts) / 90000.0
    if not n or abs(off) < 0.001:
        result['time_base'] = 'first_pts'
        return result

    # 秒は**切り捨て**で3桁にする。四捨五入だと、そのフレームの本当の時刻より
    # 後ろの値になることがあり、UI がその秒からフレーム番号を引き直すと
    # 1つ後ろのフレームになる（time_to_frame は「その時刻以降の最初の
    # フレーム」を返すため）。実測: scenes 148件中79件、
    # mutes 144件中77件が、検出したフレームと画面に出るフレームで食い違って
    # いた。切り捨てなら必ず同じフレームへ戻る（1フレーム=0.042秒 > 0.001秒）。
    def t_at(f):
        i = 0 if f < 0 else (n - 1 if f >= n else int(f))
        return math.floor((frames[i] - first_pts) / 90000.0 * 1000) / 1000.0

    for key in ('logo_ranges', 'trim_segments', 'jls_segments'):
        for x in (result.get(key) or []):
            if x.get('start_frame') is not None:
                x['start'] = t_at(x['start_frame'])
                x['end'] = t_at(x['end_frame'])
    for x in (result.get('mutes') or []):
        sf = x.get('start_frame')
        if sf is not None:
            x['start'] = t_at(sf)
            x['end'] = t_at(sf + (x.get('frames') or 0))
    for x in (result.get('scenes') or []):
        if x.get('frame') is not None:
            x['sec'] = t_at(x['frame'])
    result['time_base'] = 'first_pts'
    result['pts_offset'] = round(off, 3)
    return result
