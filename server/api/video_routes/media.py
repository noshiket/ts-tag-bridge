"""サムネ・ジャケット・波形・メディア情報・番組からの動画の解決"""

import json
import os
from datetime import datetime, timedelta
from quart import (
    jsonify,
    current_app,
    request,
    abort,
    send_file,
)
from api.routes.auth import bp  # noqa: F401
from .add_video.secondary_audio import _secondary_audio_dir  # noqa: F401


@bp.get('/videos/<int:video_id>/media')
async def video_media(video_id):
    """動画ファイルを <video src> で直に再生させるための配信（音楽用）。

    音楽は「ジャケットの静止画＋音声」の小さな MP4 なので、オンデマンドHLS
    （/api/streams/vdb/… の再エンコード）を通す意味が無い。Range に対応させて
    そのまま流す。download と分けてあるのは mimetype のため — download は iOS Safari が
    video/mp4 を fetch() ではなくネイティブ再生として横取りするのを避けるため
    application/octet-stream 固定で、これでは <video src> に使えない。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    path = video.get('file_path', '')
    if not path or not os.path.exists(path):
        abort(404, description='ファイルが見つかりません')
    response = await send_file(path, mimetype='video/mp4', conditional=True)
    # Quart は Range 要求が来た時しか Accept-Ranges を付けない。最初の 200 で
    # 名乗っておかないとシークできないと見なすプレイヤーがあるため明示する。
    response.headers['Accept-Ranges'] = 'bytes'
    response.timeout = None   # download_video と同じ理由（送信全体に掛かるため）
    return response


@bp.delete('/videos/<int:video_id>/download/secondary')
def delete_secondary_audio_cache(video_id):
    """この動画のダウンロード用に生成した一時 MP4 を削除する。

    ダウンロードは HTTP Range で分割取得するため配信中は消せない。クライアントが
    取得完了時にこれを呼んで即座に回収する（数百MB〜数GBあるため置いておきたくない）。
    副音声版(<id>_*)とメタデータ埋め込み版(<id>_meta_*)の両方が対象。
    呼ばれなかった分は定期クリーンアップが TTL 超過で掃除する。
    """
    cfg = current_app.config['ENCODE_AUTO']
    out_dir = _secondary_audio_dir(cfg)
    removed = 0
    if os.path.isdir(out_dir):
        prefix = f'{video_id}_'
        for name in os.listdir(out_dir):
            if not name.startswith(prefix):
                continue
            try:
                os.remove(os.path.join(out_dir, name))
                removed += 1
            except OSError:
                pass
    return jsonify({'deleted': removed})


def resolve_video_id_for_program(db, onid, tsid, sid, eid, eit_start_time=None, tot=None):
    """onid/tsid/sid/eid 一致 + eit_start_time ±5日 で同一番組のエンコード動画を1つ解決する。
    tot(ISO)指定時はその TOT を含む話数を優先（多話まとめ録画対応）。無ければ None。
    視聴履歴の録画エントリを video へ付け替える処理からも使う。"""
    if db is None:
        return None
    try:
        onid = int(onid); tsid = int(tsid); sid = int(sid); eid = int(eid)
    except (TypeError, ValueError):
        return None

    cands = db.find_videos_by_program(onid, tsid, sid, eid)
    if not cands:
        return None

    def _dt(s):
        try:
            d = datetime.fromisoformat(s)
        except (ValueError, TypeError):
            return None
        # tot(視聴履歴の resumeTot) は UTC 'Z' 付き=aware、eit_start_time/trim_segments は naive。
        # そのまま比較すると「offset-naive と offset-aware は比較不可」で 500 になるため、
        # aware はローカル(JST)naive へ正規化して揃える。
        if d.tzinfo is not None:
            d = d.astimezone().replace(tzinfo=None)
        return d

    # eit_start_time ±5日で絞り込み（候補が全滅したら絞り込まない）
    base = _dt(eit_start_time or '')
    if base is not None:
        win = timedelta(days=5)
        filt = [c for c in cands
                if _dt(c.get('eit_start_time')) is None or abs(_dt(c['eit_start_time']) - base) <= win]
        cands = filt or cands

    # tot を含む話数を優先（trim_segments の [最小start, 最大end] に入るもの）
    totdt = _dt(tot or '')
    if totdt is not None:
        for c in cands:
            segs = c.get('trim_segments')
            if isinstance(segs, str):
                try:
                    segs = json.loads(segs)
                except Exception:
                    segs = None
            if not segs:
                continue
            starts = [d for d in (_dt(s.get('start')) for s in segs) if d]
            ends = [d for d in (_dt(s.get('end')) for s in segs) if d]
            if starts and ends and min(starts) <= totdt <= max(ends):
                return c['id']

    # 含む話数が無ければ最新（created_at 降順の先頭）
    return cands[0]['id']


@bp.get('/videos/resolve')
def resolve_video_for_program():
    """視聴履歴(録画)から同一番組のエンコード動画を解決する。
    見つかれば {video_id} を、無ければ {video_id: null} を返す。"""
    vid = resolve_video_id_for_program(
        current_app.config.get('VIDEO_DB'),
        request.args.get('onid'), request.args.get('tsid'),
        request.args.get('sid'), request.args.get('eid'),
        request.args.get('eit_start_time'), request.args.get('tot'))
    return jsonify({'video_id': vid})


