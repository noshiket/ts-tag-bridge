"""ダウンロード（tag.json をメタデータに入れた MP4 など）"""

import asyncio
import os
import re
import subprocess
import time
from quart import (
    current_app,
    request,
    abort,
    send_file,
)
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _DeleteAfterSend  # noqa: F401
from api.routes.tag_io import _load_tag, logger  # noqa: F401
from .add_video.secondary_audio import (  # noqa: F401
    _build_secondary_audio_file,
    _secondary_audio_dir,
    _secondary_audio_locks,
)


# ── ダウンロード用: tag.json をメタデータに入れた一時 MP4 ─────────────────
# ライブラリの実ファイルは書き換えない方針なので、要求時に一時ファイルを作って配信する。
# 生成物は副音声版と同じ TTL クリーンアップ(purge_secondary_audio_cache)で回収される。
_embed_meta_locks: dict = {}


def _download_name(video: dict) -> str:
    """ダウンロード時のファイル名。確定値から組み、無ければ元のファイル名。"""
    base = os.path.basename(video.get('file_path') or '') or f'video_{video.get("id")}.mp4'
    if (video.get('media_kind') or '') == 'audio':
        # 音楽は title=アルバム / episode_name=曲名 なので、下の組み方だと
        # 「アルバム_#01_曲名」になる。置いてあるファイルと同じ「01 曲名」にする
        return base
    title = (video.get('title') or video.get('eit_title') or '').strip()
    if not title:
        return base
    ep = video.get('episode_number')
    name = f'{title}' + (f'_#{ep}' if ep not in (None, '') else '')
    epname = (video.get('episode_name') or '').strip()
    if epname:
        name += f'_{epname}'
    name = re.sub(r'[\\/:*?"<>|\r\n]', '_', name)[:150]
    return name + os.path.splitext(base)[1]


async def _build_meta_embedded_file(video: dict, tag: dict) -> str:
    """tag.json をメタデータへ埋めた MP4 を作って返す（既にあれば作り直さない）。"""
    from logic.meta import media_meta
    from logic.meta import mp4_meta
    cfg = current_app.config['ENCODE_AUTO']
    src = video['file_path']
    st = os.stat(src)
    out_dir = _secondary_audio_dir(cfg)
    os.makedirs(out_dir, exist_ok=True)
    # 元ファイルが差し替わったら作り直されるよう mtime/size をキーに含める
    # 副音声版と同じ命名規則(先頭が '<video_id>_')にして、同じ削除API/TTL掃除の対象にする
    out = os.path.join(out_dir, f'{video["id"]}_meta_{int(st.st_mtime)}_{st.st_size}.mp4')
    if os.path.exists(out):
        os.utime(out, None)          # TTL 掃除に消されないよう触っておく
        return out
    ffmpeg = cfg.get('ffmpeg', 'ffmpeg')
    await asyncio.to_thread(mp4_meta.embed_mp4_meta, src, out,
                            media_meta.build_video_meta(tag), ffmpeg)
    return out


@bp.get('/videos/<int:video_id>/download')
async def download_video(video_id):
    """video.db の動画ファイルを無変換でそのまま配信（ローカルキャッシュ用）。

    ?audio=secondary で副音声版を生成して配信する（音声切替できないブラウザ向け）。
    ?source=1 で音楽の変換元（AIFF等の原本）を配信する。既定は file_path
    （音楽では再生用MP4）で、ローカル保存はこちらを取る。
    """
    db = current_app.config.get('VIDEO_DB')
    if db is None:
        abort(404)
    video = db.get_video_row(video_id)
    if video is None:
        abort(404)
    path = video.get('file_path', '')
    src_mode = request.args.get('source') or ''
    lossless_tmp = None
    if src_mode:
        # 音楽の可逆音源。再生用MP4 の音声は AAC で非可逆なので、こちらを配る。
        # 変換元の原本が残っていればそれを、無ければ取り込み時に作った可逆の控えを使う
        # （AAC から可逆形式へ戻しても音は戻らないので、この2つだけが可逆の手段）。
        tag = _load_tag(path + '.tag.json') or {}
        # 控えを先に見る。曲情報を直した時にタグを書き込んでいるのはこちらで、
        # 原本は取り込んだ時のまま（＝編集した歌詞などが入っていない）
        cands = [tag.get('archive_path') or '', video.get('source_path') or '']
        src = next((c for c in cands if c and os.path.exists(c)), '')
        if not src:
            abort(404, description='可逆の音源が残っていません')
        want_aiff = src_mode == 'aiff' and not src.lower().endswith(('.aiff', '.aif'))
        # 原本しか無い場合は、編集した曲情報を持たせるために詰め替える
        retag = bool(tag.get('media_tags')) and src == (video.get('source_path') or '')
        if want_aiff or retag:
            # 可逆同士の詰め替えなので音は変わらない（FLAC → AIFF はビット単位で同じ）
            cfg = current_app.config['ENCODE_AUTO']
            out_dir = _secondary_audio_dir(cfg)
            os.makedirs(out_dir, exist_ok=True)
            ext = '.aiff' if want_aiff else os.path.splitext(src)[1]
            lossless_tmp = os.path.join(
                out_dir, f'{video_id}_lossless_{int(time.time())}{ext}')
            cmd = [cfg.get('ffmpeg', 'ffmpeg'), '-nostdin', '-y', '-v', 'error',
                   '-i', src, '-vn']
            cmd += ['-c:a', 'pcm_s16be'] if want_aiff else ['-c:a', 'copy']
            for k, v in (tag.get('media_tags') or {}).items():
                cmd += ['-metadata', f'{k}={v}']
            if ext in ('.aiff', '.aif'):
                cmd += ['-write_id3v2', '1']   # これが無いと AIFF にタグが入らない
            cmd.append(lossless_tmp)
            r = await asyncio.to_thread(subprocess.run, cmd,
                                        capture_output=True, text=True, timeout=600)
            if r.returncode != 0 or not os.path.exists(lossless_tmp):
                abort(500, description=f'可逆音源の書き出しに失敗しました: {(r.stderr or "")[:200]}')
            src = lossless_tmp
        path = src
    if not path or not os.path.exists(path):
        abort(404, description='動画ファイルが見つかりません')

    # ?embed=1: tag.json の内容をメタデータへ入れた MP4 を配信する。
    # ファイル単体を別サーバーへ持ち込んでも取り込み直せるようにするため。
    # ?attach=1: 端末へのダウンロードとして保存させる(確定値から付けた名前で)。
    embed = request.args.get('embed') == '1'
    attach = request.args.get('attach') == '1'
    embedded_tmp = None
    if embed and request.args.get('audio') != 'secondary':
        tag = _load_tag((video.get('file_path') or '') + '.tag.json')
        if tag:
            lock = _embed_meta_locks.setdefault(video_id, asyncio.Lock())
            async with lock:
                try:
                    path = embedded_tmp = await _build_meta_embedded_file(video, tag)
                except Exception as e:
                    import logging as _lg
                    _lg.getLogger(__name__).warning(
                        'download_video: メタデータ埋め込みに失敗 id=%s: %s', video_id, e)
        else:
            import logging as _lg
            _lg.getLogger(__name__).info(
                'download_video: tag.json が無いので埋め込みなしで配信します id=%s', video_id)

    if request.args.get('audio') == 'secondary':
        lock = _secondary_audio_locks.setdefault(video_id, asyncio.Lock())
        async with lock:
            try:
                path = await _build_secondary_audio_file(video)
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).warning('download_video: 副音声版の生成に失敗 id=%s: %s', video_id, e)
                abort(409, description=f'副音声版の生成に失敗しました: {e}')
    # application/octet-stream にすることで iOS Safari が video/mp4 を fetch() ではなく
    # ネイティブ再生/ダウンロードとして横取りしてページリロードを引き起こすのを防ぐ。
    # conditional=True: Range/If-Range に対応させる（VideoCache のチャンク分割ダウンロードが
    # 途中失敗時に Range で続きだけ取得する＝レジュームに使う）。Quart の send_file は
    # conditional の既定が False のため明示しないと 206 Partial Content を返さない。
    # 可逆音源は変換後と拡張子が違う。曲名で保存されるよう確定値から名前を組む
    dl_name = ((os.path.splitext(_download_name(video))[0] + os.path.splitext(path)[1])
               if src_mode else _download_name(video))
    response = await send_file(path, mimetype='application/octet-stream',
                               as_attachment=attach,
                               attachment_filename=(dl_name if attach else None),
                               conditional=True)
    logger.info('download_video: 配信 id=%s range=%s if_range=%s bytes=%s file=%s',
                video_id, request.headers.get('Range') or 'none',
                request.headers.get('If-Range') or 'none',
                response.headers.get('Content-Range') or 'full', os.path.basename(path))
    # Quart の RESPONSE_TIMEOUT(既定60秒)はレスポンス送信全体(=ファイル全体のストリーミング)に
    # 掛かるため、60秒を超える大容量動画のダウンロードが必ず失敗する不具合があった
    # （クライアント側からは "The operation failed for an unknown transient reason" 等の
    # 汎用ネットワークエラーとして観測される）。実機curlで60秒ちょうどで打ち切られることを
    # 確認済み。このエンドポイントはファイル配信専用で応答時間はファイルサイズ/回線速度に
    # 依存するため、タイムアウトを無効化する。
    response.timeout = None
    # 埋め込み用の一時ファイルは送り切った時点で回収する（副音声版と同じ扱い）。
    # 206(Range)は続きを取りに来るので残す＝TTL掃除に任せる。
    if embedded_tmp and response.status_code == 200:
        response.response = _DeleteAfterSend(response.response, embedded_tmp)
    if lossless_tmp and response.status_code == 200:
        response.response = _DeleteAfterSend(response.response, lossless_tmp)
    return response


