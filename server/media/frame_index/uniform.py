"""フレーム表を一定の間隔で作る（プルダウンを弾く・音声の PTS）"""

import data_paths
import os
from typing import List


# Bフレームの並べ替えでPTSがどれだけ前後してよいか(90kHz)。1秒あれば
# 通常のGOP内の並べ替えは収まる。これを超える巻き戻りは別タイムラインの混入。
_MAX_REORDER_PTS = 90000


def _build_frame_table_uniform(ts_path: str, audio_pid=None):
    """フレーム間隔が一定な素材の表を ffprobe の表示PTSから作る。

    ES を解かずに済むのは「1フレーム＝1エントリ」が保証される時だけ。
    RFF/プルダウン/フィールドピクチャがあると同じPTSが複数並んだり
    halfDelay が要るので、間隔が揃っていなければ RuntimeError にする。

    音声PTSも一緒に返す。**無音区間の検出に要る**ため省けない
    （省いたら chapterexe が「無音区間 0 個 / 映像走査 0 フレーム」になった）。
    TOT は配信TSに無いので空。

    戻り値は build_frame_table と同じ
    (framePTS, halfDelay, audio_pid, audioPES_PTS, totEntries)。
    """
    import json as _json
    import subprocess as _sp
    ffprobe = os.environ.get('FFPROBE') or _default_ffprobe()
    # プルダウン/インターレースの判定は先頭だけ見る。この判定に要る
    # repeat_pict / interlaced_frame は frame= でしか出ず、frame= は
    # **全フレームの復号を伴う**ため全編に掛けると極端に遅い
    # （実測: 114分の素材で19.5分）。符号化の作りは途中で変わらないので、
    # 先頭を見れば足りる。
    _reject_pulldown(ffprobe, ts_path)

    # PTS 自体は復号の要らない packet= から取る。H.264/TS では
    # 1PESパケット = 1アクセスユニット = 1フレームなので frame= と同数になる
    # （実測: 同じ素材でどちらも 164325 フレーム）。
    r = _sp.run([ffprobe, '-v', 'error', '-select_streams', 'v:0',
                 '-show_entries', 'packet=pts', '-of', 'json', ts_path],
                capture_output=True, text=True, timeout=1800)
    pts: List[int] = []
    for pk in (_json.loads(r.stdout or '{}').get('packets') or []):
        v = pk.get('pts')
        if v is None:
            continue
        pts.append(int(v))
    if len(pts) < 2:
        raise RuntimeError(f'フレームが取れません: {ts_path}')
    # PTSの振り直し(タイムライン断絶)は並べ替えると隠れてしまうので、
    # パケット順のまま先に見る。Bフレームの並べ替えでもPTSは前後するが、
    # それは1GOP程度に収まる。それを超える巻き戻りは別タイムラインの混入で、
    # 並べ替えると2本のタイムラインが噛み合って出鱈目な表になる。
    for a, b in zip(pts, pts[1:]):
        if b - a < -_MAX_REORDER_PTS:
            raise RuntimeError(
                f'PTSが振り直されているため未対応(CMCheck経路を使用): {a} → {b}')

    pts.sort()
    deltas = [pts[i] - pts[i - 1] for i in range(1, len(pts))]
    # 間隔の種類数では判定しない。29.97fps は 3003/3004 が混ざり、配信の
    # 23.976fps も 3753/3754 が混ざる上、途中に 30fps の差し込みが入って
    # 4種類以上になることがある（実測: {3753,3754,3000,4508}）。
    #
    # 前へ大きく飛ぶぶんも許す。広告を捨てた継ぎ目にPTSの穴が残る配信があり
    # （実測: ニュースの配信で 56秒地点に120秒の穴）、穴があっても
    # 「1エントリ＝1フレーム」は保たれるので表としては正しい。
    #
    # 崩れるのは同一PTSが並ぶ場合(プルダウン等で1コマ=1エントリでない)だけ。
    # RFF/インターレースは上の repeat_pict / interlaced_frame でも弾いている。
    if min(deltas) <= 0:
        raise RuntimeError(f'同一PTSのフレームがあるため未対応(CMCheck経路を使用): {ts_path}')
    return pts, [False] * len(pts), audio_pid, _audio_pts_via_ffprobe(ts_path), []


def _reject_pulldown(ffprobe: str, ts_path: str, seconds: int = 60) -> None:
    """先頭 seconds 秒を復号して、プルダウン/インターレースなら弾く。

    どちらも「1コマ=1エントリ」を崩すので、表をPTSから組み立てられない。
    全編を見ないのは、frame= 指定の ffprobe が全フレーム復号になるため。
    """
    import json as _json
    import subprocess as _sp
    r = _sp.run([ffprobe, '-v', 'error', '-select_streams', 'v:0',
                 '-read_intervals', f'%+{seconds}',
                 '-show_entries', 'frame=interlaced_frame,repeat_pict',
                 '-of', 'json', ts_path], capture_output=True, text=True, timeout=600)
    for fr in (_json.loads(r.stdout or '{}').get('frames') or []):
        if fr.get('repeat_pict'):
            raise RuntimeError(f'repeat_pict があるため未対応(CMCheck経路を使用): {ts_path}')
        if fr.get('interlaced_frame'):
            raise RuntimeError(f'インターレース素材は未対応(CMCheck経路を使用): {ts_path}')


def _audio_pts_via_ffprobe(ts_path: str) -> List[int]:
    """主音声パケットのPTS列。無音検出はこの表で音声位置を決める。"""
    import json as _json
    import subprocess as _sp
    ffprobe = os.environ.get('FFPROBE') or _default_ffprobe()
    try:
        r = _sp.run([ffprobe, '-v', 'error', '-select_streams', 'a:0',
                     '-show_entries', 'packet=pts', '-of', 'json', ts_path],
                    capture_output=True, text=True, timeout=1800)
        out = []
        for pk in (_json.loads(r.stdout or '{}').get('packets') or []):
            v = pk.get('pts')
            if v is not None:
                out.append(int(v))
        out.sort()
        return out
    except Exception:
        return []


def _default_ffprobe() -> str:
    """同梱の ffprobe。無ければ PATH のものに任せる。"""
    p = os.path.join(data_paths.SERVER_DIR, 'thirdparty', 'FFmpeg', 'ffprobe')
    return p if os.path.isfile(p) else 'ffprobe'
