"""動画の1コマ・サムネイルを取り出す（キーフレームからのシーク・vsync の指定）"""

import re
import os
import subprocess
import threading


import logging

# 元の media.probe.ffprobe と同じ名前でログに出す
logger = logging.getLogger('media.probe.ffprobe')


# 静止画を取り出す ffmpeg の同時実行数。分割画面は開いた時に話数ぶん
# （実測で 17枚）まとめて要求するので、そのまま並べると ffmpeg が
# 17本立ち、CPU を食い合って他の API まで遅くなる（実測: 同時17本のさなかに
# /frames が 4.7秒。クライアントの打ち切りは 8秒）。録画とエンコードの隣で
# 動いているので、絞ったほうが全体では速い。
_FRAME_JOBS = threading.BoundedSemaphore(4)


# 録画ごとの「効いた戻す幅」。-ss の行き過ぎ方はファイルの素性で決まるので、
# 1枚目で分かった幅を次からの出発点にする。分割画面は同じ録画から話数ぶん
# （実測17枚）取るので、毎回 2→8→32 と探り直すと1枚あたり 3.5秒かかっていた。
_PRE_BACK_HINT = {}


_PRE_BACK_MAX_KEYS = 8


def _keyframe_pre_seek(key_frames, timestamp_sec: float) -> float | None:
    """key_frames=[{'offset':int,'dts':90kHz}] から timestamp_sec 以下の最近キーフレーム時刻を返す。

    無効/該当なしは None。dts は録画先頭からの 90kHz tick（video_segment_planner と同じ規則）。
    """
    if not key_frames:
        return None
    try:
        import bisect
        base = key_frames[0]['dts']
        target = base + timestamp_sec * 90000
        dts_list = [kf['dts'] for kf in key_frames]
        idx = bisect.bisect_right(dts_list, target) - 1
        if idx < 0:
            return None
        kf_t = (key_frames[idx]['dts'] - base) / 90000.0
        return max(0.0, kf_t - 0.05)  # ffmpeg 入力 -ss の丸めで対象キーフレームを跨がないよう少し手前
    except Exception:
        return None


_VSYNC_CACHE = {}


def vsync_opts(ffmpeg_path: str) -> list:
    """1フレームだけ出すときの「フレーム複製をしない」指定を返す。

    -vsync は FFmpeg 8(libav 63)で削除され、-fps_mode passthrough が後継。
    同梱版のバージョンがサーバーごとに違い、別のサーバーでは
    `Unrecognized option 'vsync'` で静止フレームの取得が全て 500 になっていた。
    どちらが通るかは ffmpeg に聞いて憶えておく。
    """
    got = _VSYNC_CACHE.get(ffmpeg_path)
    if got is None:
        try:
            r = subprocess.run([ffmpeg_path, '-hide_banner', '-h', 'full'],
                               capture_output=True, timeout=30)
            out = (r.stdout or b'') + (r.stderr or b'')
            got = ['-fps_mode', 'passthrough'] if b'fps_mode' in out else ['-vsync', '0']
        except Exception:
            got = ['-vsync', '0']
        _VSYNC_CACHE[ffmpeg_path] = got
    return got


def get_frame_by_pts(ffmpeg_path: str, ts_path: str, frame_pts: int, first_pts: int,
                     width: int = 240) -> bytes | None:
    """フレーム表の絶対PTS frame_pts にピタリ合うフレームを JPEG で返す。取得失敗時は None。

    get_thumbnail の「時刻 t で -ss」方式は t=0 基準が ffmpeg 依存(映像ストリーム先頭 or
    キーフレーム量子化)で、frame_index.time_to_frame(= 番号表示/実カット)とズレる。
    ここでは -copyts で原 PTS を保ったまま select='gte(pts,frame_pts)' で該当フレームを
    厳密に 1 枚選ぶため、番号表示・実カットと同じフレームが得られる。

    frame_pts: 目標フレームの絶対PTS(90kHz, frames[N])。
    first_pts: フレーム表の基準PTS。pre-seek 位置の算出にのみ使用(select が本判定)。
    """
    target_sec = (frame_pts - first_pts) / 90000.0
    wrapped = frame_pts % (1 << 33)  # 原ストリームの PTS は 33bit で巻き戻る

    # 手前へ戻す幅。ふつうは 2秒(1〜2 GOP)で足りるが、PTS に飛びがある録画だと
    # ffmpeg の -ss が**行き過ぎる**。時刻からバイト位置を推定する二分探索が、
    # タイムスタンプが単調でないと外れるため。
    # 実測（PTS の飛び 420秒）: 3231.5秒を要求して 3253.8秒に着地。
    # 3231.5秒と3236.5秒で同じフレームが返り、分割画面で「移動しても前後の絵が
    # 同じ」に見えていた。行き過ぎた先から gte(pts,目標) を探しても、目標は
    # 既に過ぎているので拾えない。
    #
    # 越えていたら**越えた分だけ**戻してやり直す。2→60→180→600秒と決め打ちで
    # 広げると、2.5秒しか越えていない時でも 60秒ぶん復号することになり、
    # 1枚 36.5秒かかった（分割画面は一度に17枚要求するので、他の API が 8秒の
    # タイムアウトに巻き込まれて「近似フレーム」「ずっとLoading」になった）。
    #
    # 判定は 1フレーム(約0.042秒)。frames[N] はフレーム表の値そのものなので、
    # 目標の手前へ着ければ select=gte が拾う絵の pts はぴたり一致する。
    pre_back = max(2.0, float(_PRE_BACK_HINT.get(ts_path) or 0.0))
    data = None
    for _ in range(5):
        pre_seek = max(0.0, target_sec - pre_back)
        data, landed = _grab_frame(ffmpeg_path, ts_path, pre_seek, wrapped, width,
                                   frame_pts, first_pts)
        if data is None or landed is None or landed <= target_sec + 0.05:
            if landed is not None and pre_back > 2.0:
                _PRE_BACK_HINT[ts_path] = pre_back
                while len(_PRE_BACK_HINT) > _PRE_BACK_MAX_KEYS:
                    _PRE_BACK_HINT.pop(next(iter(_PRE_BACK_HINT)))
            return data
        if pre_seek <= 0.0:
            return data
        over = landed - target_sec
        # 着地の誤差より **-ss 自体の行き過ぎ** の方が大きい。実測:
        # -ss 1580 で最初に出る絵が 1586.4 秒（6.4秒ぶん飛ばされている）。
        # 「行き過ぎた分だけ戻す」では足りず、同じ絵が返り続ける。
        # 実測で要る幅（当たるまで）: frame 35476 は 8秒 / frame 268207 は 16秒。
        # 2倍ずつ広げ、着地の誤差の3倍も下限にする。ほとんどは1回目で当たる。
        # 4倍ずつだと落ち着く先が 32秒になり、以後1枚 3.8秒かかっていた
        # （2倍なら 16秒で済み 1.5秒）。前送りの復号がそのまま値段になる。
        nxt = min(600.0, max(pre_back * 2.0, over * 3.0 + 2.0))
        logger.info('get_frame_by_pts: %s秒を要求して %s秒に着地(%s秒行き過ぎ)。'
                    '戻す幅 %s → %s秒でやり直す',
                    round(target_sec, 1), round(landed, 1), round(over, 1),
                    round(pre_back, 1), round(nxt, 1))
        pre_back = nxt
    return data


def _grab_frame(ffmpeg_path, ts_path, pre_seek, wrapped, width, frame_pts, first_pts):
    """1枚取り出す。(画のバイト列, 実際に着地した秒) を返す。"""
    try:
        cmd = [
                ffmpeg_path,
                # 取り込みの TS は CM を捨てて録るぶん壊れたパケットが混ざり、
                # 既定の上限(0.666)を超えて ffmpeg が打ち切る。
                # 実測: "Decode error rate 0.946429 exceeds maximum 0.666667"
                # で終了コード 69。画は作れているのに捨てていた。
                '-max_error_rate', '1.0',
                '-copyts',
                '-ss', f'{pre_seek:.3f}',
                '-i', ts_path,
                # 手前から送るぶん、音声・字幕まで復号すると丸ごと無駄になる
                '-map', '0:v:0', '-an', '-sn', '-dn',
                '-vf', (f'select=gte(pts\\,{wrapped}),scale=iw*sar:ih,'
                        f'scale={width}:-2,showinfo'),
                '-vframes', '1',
                *vsync_opts(ffmpeg_path),
                '-f', 'image2',
                '-vcodec', 'mjpeg',
                'pipe:1',
        ]
        with _FRAME_JOBS:
            result = subprocess.run(cmd, capture_output=True, timeout=60)
        # showinfo が出す pts_time で、本当にそこへ着いたかを見る
        landed = None
        m = re.search(rb'pts_time:([0-9.]+)', result.stderr or b'')
        if m:
            try:
                landed = float(m.group(1)) - first_pts / 90000.0
            except ValueError:
                landed = None
        # 画が出ていれば使う。デコード誤りがあると終了コードが 0 にならないが、
        # 1枚取り出す用途では中身が取れていれば十分（黒画面になるより良い）。
        if result.stdout:
            if result.returncode != 0:
                logger.info('get_frame_by_pts: rc=%s だが画は取れたので使う (pts=%s)',
                            result.returncode, frame_pts)
            return result.stdout, landed
        # 失敗を黙って None にすると、呼び出し側は 500 を返すだけで理由が残らない。
        # 実際これで「分割画面の静止画が黒い」の切り分けに時間を取られた。
        logger.warning('get_frame_by_pts 失敗: rc=%s pts=%s cmd=%s / %s',
                       result.returncode, frame_pts, ' '.join(cmd),
                       (result.stderr or b'')[-600:].decode('utf-8', 'replace').strip())
        return None, None
    except Exception as e:
        logger.warning('get_frame_by_pts 例外: %s pts=%s ts=%s',
                       e, frame_pts, os.path.basename(ts_path))
        return None, None


# サムネイル（ここの関数を使うので、定義した後で読む）
