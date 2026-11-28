"""局の設定・ロゴ・JL の置き場・作業フォルダ・フレーム表"""

import data_paths  # server/ と server/data の場所
import os
import re
import subprocess


def _now_iso():
    from datetime import datetime
    return datetime.now().isoformat(timespec='seconds')

# Amatsukaze コンテナ内の JL / ロゴの置き場
_JL_DIR = '/app/JL'
_LOGO_DIR = '/app/logo'
_CONTAINER = 'amatsukaze'
# 原典: AmatsukazeServer/Server/EncodeServerData.cs:1049 LogoSetting.NO_LOGO
# この名前の登録は「ロゴを使わない」の意味で、実体のあるロゴではない
_NO_LOGO = '### NO LOGO ###'


def _amz(config):
    """Amatsukaze クライアント。接続先は main.py と同じ設定から取る。"""
    from clients.amatsukaze_api.core import AmatsukazeClient
    cfg = config or {}
    url = ((cfg.get('amatsukaze_servers') or [{}])[0].get('url')) \
        or cfg.get('Amatsukaze_url') or cfg.get('amatsukaze_url')
    return AmatsukazeClient(url) if url else AmatsukazeClient()


def service_id_of(rec):
    """録画行(recordings の行)から serviceId を取る。"""
    rec = rec or {}
    for k in ('service_id', 'sid', 'onid_sid'):
        v = rec.get(k)
        if v:
            return int(str(v).split('-')[-1])
    return 0


def service_setting(config, sid):
    """このチャンネルの設定を Amatsukaze から取る。

    どのロゴを使うか・どの JL を使うか・そもそも CM カットするかは Amatsukaze 側の
    チャンネル設定が持っている。同じ判断をしないと本体と結果が食い違うので、
    ここでは自前で決めず必ずサーバーの設定に従う。
    """
    for s in _amz(config).get_service_settings() or []:
        if int(s.get('serviceId') or -1) == sid:
            return s
    return None


def recorded_at_of(rec):
    """録画時刻。ロゴの有効期間(from〜to)の判定に使う。"""
    from datetime import datetime
    rec = rec or {}
    for k in ('recording_start_time', 'start_time', 'eit_start_time'):
        v = rec.get(k)
        if v:
            try:
                return datetime.fromisoformat(str(v).replace('Z', '+00:00')).replace(tzinfo=None)
            except ValueError:
                pass
    return datetime.now()


def _video_info(path):
    """解像度・fps・総フレーム数を ffprobe で取る。"""
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=width,height,r_frame_rate:format=duration',
         '-of', 'default=nw=1', path], capture_output=True, text=True)
    d = dict(ln.split('=', 1) for ln in r.stdout.strip().splitlines() if '=' in ln)
    num, den = (d.get('r_frame_rate') or '30000/1001').split('/')
    fps = float(num) / float(den)
    return (int(d.get('width') or 0), int(d.get('height') or 0), fps,
            int(round(float(d.get('duration') or 0) * fps)))


def _work_dir(ts_path):
    """作業ディレクトリ。録画の置き場は汚さずデータの置き場（server/data）の下に作る。

    中身はテキストだけなので小さい。Amatsukaze の中間ファイルと同じ名前で置くので
    そのまま diff できる。
    """
    return os.path.join(data_paths.DATA_DIR, 'cmcut_py',
                        re.sub(r'\W+', '_', os.path.basename(ts_path))[:80])


def _to_seconds(segs, t_at, tot_at=None):
    tot_at = tot_at or (lambda _n: None)
    return [{'start': t_at(s), 'end': t_at(e),
             'start_frame': s, 'end_frame': e,
             'start_tot': tot_at(s), 'end_tot': tot_at(e)} for s, e in segs]


def _frame_table(rec_id, ts, work):
    """フレーム表を用意して (PTSリスト, .fidx.gz のパス) を返す。

    同じ表を logic/add_recording.py が登録スキャン時に
    server/data/frame_index/{rec_id}.fidx.gz へ作っている（走査に18秒かかる）。
    あればそれを使い、無ければ作る。rec_id が無い呼ばれ方では作業ディレクトリに置く。

    パスも返すのは logoframe/chapterexe へ --vpts-file で渡すため。フレーム番号は
    この表の位置で決まり、halfDelay の合成にも要る（media/amatsukaze/amt_source.AMTSource 参照）。
    """
    from media.frame_index.table_file import frame_index_path
    from media.frame_index.cache import get_or_build_frame_table
    if rec_id:
        data_dir = data_paths.DATA_DIR
        cache = frame_index_path(rec_id, data_dir)
    else:
        cache = os.path.join(work, 'frame_index.fidx.gz')
    get_or_build_frame_table(ts, cache)
    from media.frame_index.table_file import load_frame_table
    frames, _fp, _half, _apid, _apts, tots = load_frame_table(
        cache, with_half=True, with_audio=True, with_tot=True)
    return frames, cache, tots
