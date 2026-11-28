"""mp4_frames — MP4 の映像フレーム表(表示時刻の一覧)を作って tag.json へ入れる。

TS は MPEG-2 のピクチャヘッダを自前解析してフレーム表を作っている(media/frame_index.py)が、
MP4 は moov のサンプル表に全フレームの時刻が入っているので ffprobe で読むだけで済む
(実測: 35,716フレームで 0.13 秒。デコードは不要)。

エンコード済みの動画は可変フレームレートになることがある(本編24p + テロップ30p 等)ため、
「1/30 秒ずつ動かす」ような決め打ちではコマ送りが合わない。実際のフレーム時刻を持たせて
そこへ乗せるためのデータ。

tag.json へ入れる形式(frame_table):

    {
      "timebase": 90000,          # PTS の単位(1秒あたり)
      "count":    35716,          # フレーム数
      "first":    0,              # 先頭フレームの PTS
      "deltas":   [4004, 5005],   # 出現する差分の種類(小さい順)
      "index":    "H4sIA...",     # フレームごとの差分番号を gzip+base64 したもの
    }

素の PTS 配列だと 360KB あるが、差分の種類が数種類しかないので
「差分番号を1フレーム1バイト → gzip」で 2〜7KB に収まる(実測)。
"""

import base64
import gzip
import json
import logging
import subprocess

logger = logging.getLogger(__name__)

# 1フレーム1バイトで持つので、差分の種類がこれを超える動画は対象外にする
# (可変フレームレートでも実測5種類。超えるなら素性が違うので諦めてよい)
_MAX_DELTA_KINDS = 200
# 極端に長い動画で処理が張り付かないための上限
_MAX_FRAMES = 2_000_000


def build(path: str, ffprobe: str = 'ffprobe', timeout: int = 300):
    """MP4 のフレーム表を作って返す。作れなければ None。"""
    # time_base はパケットには出ないので stream から取る（ffprobe のバージョン差で
    # packet=time_base が空になり、フレーム表を作れないことがあった）
    cmd = [ffprobe, '-v', 'error', '-select_streams', 'v:0',
           '-show_entries', 'stream=time_base:packet=pts', '-of', 'json', path]
    try:
        out = subprocess.run(cmd, check=True, timeout=timeout,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        data = json.loads(out or b'{}')
    except Exception as e:
        logger.info('フレーム表を作れませんでした %s: %s', path, e)
        return None

    packets = data.get('packets') or []
    pts = sorted(int(p['pts']) for p in packets if p.get('pts') not in (None, 'N/A'))
    if len(pts) < 2 or len(pts) > _MAX_FRAMES:
        return None

    streams = data.get('streams') or []
    tb = next((st.get('time_base') for st in streams if st.get('time_base')), None)
    timebase = _timebase_hz(tb)
    if not timebase:
        return None

    deltas = [pts[i + 1] - pts[i] for i in range(len(pts) - 1)]
    kinds = sorted(set(deltas))
    if len(kinds) > _MAX_DELTA_KINDS:
        logger.info('フレーム間隔の種類が多すぎるため見送ります(%d種): %s', len(kinds), path)
        return None

    pos = {v: i for i, v in enumerate(kinds)}
    packed = gzip.compress(bytes(pos[d] for d in deltas), 9)
    return {
        'timebase': timebase,
        'count': len(pts),
        'first': pts[0],
        'deltas': kinds,
        'index': base64.b64encode(packed).decode('ascii'),
    }


def _timebase_hz(tb):
    """'1/90000' → 90000。読めなければ None。"""
    if not tb or '/' not in str(tb):
        return None
    num, _, den = str(tb).partition('/')
    try:
        num, den = int(num), int(den)
    except ValueError:
        return None
    return den if num == 1 and den > 0 else None


def times(table) -> list:
    """フレーム表 → 各フレームの表示時刻(秒)のリスト。壊れていれば空リスト。"""
    if not isinstance(table, dict) or not table.get('index'):
        return []
    try:
        kinds = table['deltas']
        raw = gzip.decompress(base64.b64decode(table['index']))
        tb = float(table['timebase'])
        pts, cur = [table['first']], table['first']
        for i in raw:
            cur += kinds[i]
            pts.append(cur)
        return [p / tb for p in pts]
    except Exception as e:
        logger.warning('フレーム表を展開できませんでした: %s', e)
        return []


def summary(table) -> str:
    """ログ表示用の要約。"""
    if not table:
        return 'なし'
    n, kinds = table.get('count'), table.get('deltas') or []
    tb = table.get('timebase') or 1
    fps = [round(tb / k, 3) for k in kinds]
    return f'{n}フレーム / 間隔{len(kinds)}種 ({", ".join(f"{f}fps" for f in fps[:4])})'
