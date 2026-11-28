"""字幕・副音声・Amatsukaze の作業フォルダなど、再生と変換の補助"""

import json
import os
import time
from quart import (
    current_app,
    abort,
)
# 各機能の API を Blueprint(bp) に登録する（読み込むと @bp.* が走る）。
# 子モジュールは bp と共通の補助をここから読むので、末尾で読み込む


# 手動追加のフォームで受け取る文字列フィールド。tag.json へそのまま入れる
# (video.db 側は _VIDEO_TAG_COLS で同名列に取り込まれる)。
# psisimux が MP4 → MPEG-TS へ載せられる映像コーデック。ここに無いもの(AV1/VP9 等)は
# サーバー側の HLS 経路が成立しないので、プレイヤーは直接再生へ切り替える
_TS_STREAMABLE_VIDEO_CODECS = {'h264', 'hevc', 'mpeg2video'}
# psisimux が読める音声。これ以外(Opus 等)の MP4 は "No audio track" で何も出さずに終わり、
# エンコーダに何も届かず空のセグメントが返る（動画サイトから取り込んだ Opus の MP4 で再生できなかった）
_TS_STREAMABLE_AUDIO_CODECS = {'aac'}
# ダウンロード完了通知が来なかった場合に生成物を残しておく時間（秒）。
# ダウンロードは HTTP Range で分割取得するため配信中は消せない。完了時にクライアントが
# 削除を要求する（下の DELETE）が、中断・タブを閉じた等で来ないことがあるので保険で掃除する。
_SECONDARY_AUDIO_TTL = 6 * 3600


def purge_secondary_audio_cache(tmp_base: str, ttl: int = _SECONDARY_AUDIO_TTL) -> int:
    """副音声版 MP4 の生成物のうち、最終更新から ttl 秒を過ぎたものを削除する。
    戻り値は削除数。定期クリーンアップ(db_cleanup)から呼ぶ。"""
    d = os.path.join(tmp_base or '', 'secondary_audio')
    if not tmp_base or not os.path.isdir(d):
        return 0
    now = time.time()
    removed = 0
    for name in os.listdir(d):
        p = os.path.join(d, name)
        try:
            if os.path.isfile(p) and now - os.path.getmtime(p) > ttl:
                os.remove(p)
                removed += 1
        except OSError:
            pass
    return removed


class _DeleteAfterSend:
    """レスポンスを最後まで送り切ったら一時ファイルを消す非同期イテラブル。

    副音声版のダウンロードはクライアント(VideoCache)が取得完了を知っていて
    削除APIを叩けるが、ブラウザのダウンロードは完了通知が取れない。
    送信し切った時点をサーバー側で捉えて同等に回収する。
    途中で切れた場合は消さない（Rangeでの再取得に使えるよう残し、TTL掃除に任せる）。
    """

    def __init__(self, inner, path):
        self._inner = inner
        self._path = path

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        async for chunk in self._inner:
            yield chunk
        try:
            os.remove(self._path)
        except OSError:
            pass

    async def __aenter__(self):
        if hasattr(self._inner, '__aenter__'):
            await self._inner.__aenter__()
        return self

    async def __aexit__(self, *args):
        if hasattr(self._inner, '__aexit__'):
            await self._inner.__aexit__(*args)


# ---------------------------------------------------------------------------
# Amatsukaze プロキシ
# ---------------------------------------------------------------------------

def _amz():
    client = current_app.config.get('AMATSUKAZE_CLIENT')
    if client is None:
        abort(503, description='Amatsukaze client not configured')
    return client


def _amz_remove_amt_dir(amt_dir):
    """作業フォルダ(amt*)を消す。判断は logic 側の remove_amt_dir に集約している。"""
    from logic.encode_pipeline.amatsukaze.queue import remove_amt_dir
    return remove_amt_dir(amt_dir)


def _caption3_tracks(raw) -> list:
    """captions3_json（後付け字幕・list形式）をトラックのリストとして返す。

    各要素: {name, source, created_at, captions:[{pts, duration_ms, clear_screen, tokens}]}
    壊れている/未設定なら空リスト。
    """
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [t for t in data if isinstance(t, dict) and isinstance(t.get('captions'), list)]


def _parse_captions_data(raw: str | None) -> list:
    """captions_json 文字列を [{pts, duration_ms, clear_screen, tokens}] のリストに変換する。"""
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return []
    captions = data.get('captions') if isinstance(data, dict) else data
    if not isinstance(captions, list):
        return []
    out = []
    for cap in captions:
        tokens = cap.get('tokens')
        if not tokens:
            continue
        out.append({
            'pts': cap.get('pts', 0.0),
            'duration_ms': cap.get('duration_ms'),
            'clear_screen': bool(cap.get('clear_screen', False)),
            'tokens': tokens,
        })
    return out
