"""条件付きGET (ETag / 304 Not Modified)。

予約・録画・アルバム一覧は画面に関係なく30秒ごとにポーリングされるが、中身は数分〜
数十分変わらないことが多い。ETag を付けて If-None-Match が一致したら 304 を返せば、
変化が無い間の応答は本文ゼロ(ヘッダだけ)で済む。gzip 圧縮(api/web/compression.py)と併用すると
「変化があった時だけ圧縮済み本文が飛ぶ」形になる。

ETag は圧縮前の本文から作る(圧縮の有無で値が変わらないように W/ の弱い ETag にする)。
そのため compression より後に登録すること — after_request は登録の逆順に走る。
"""

import hashlib

from quart import request

_MIN_BYTES = 256                   # これ未満はハッシュを取るだけ無駄
# 実体をメモリに持っている応答だけ触る(動画/HLSのような流す応答は get_data() できない)
_BODIES = ('DataBody', 'FileBody', 'IOBody')


def _matches(header: str, etag: str) -> bool:
    """If-None-Match ヘッダが etag に一致するか。"""
    if not header:
        return False
    if header.strip() == '*':
        return True
    # W/ の有無は同一視する(弱い比較。RFC 7232 の If-None-Match はこれが正)
    def _norm(v):
        v = v.strip()
        return v[2:] if v.startswith('W/') else v
    return any(_norm(v) == _norm(etag) for v in header.split(','))


def install(app) -> None:
    """アプリに ETag/304 の after_request を登録する。"""

    @app.after_request
    async def add_etag(response):
        if request.method not in ('GET', 'HEAD') or response.status_code != 200:
            return response
        if response.headers.get('ETag'):
            return response
        if (response.content_type or '').split(';')[0].strip() != 'application/json':
            return response
        if type(response.response).__name__ not in _BODIES:
            return response
        data = await response.get_data()
        if len(data) < _MIN_BYTES:
            return response

        etag = f'W/"{hashlib.blake2b(data, digest_size=16).hexdigest()}"'
        response.headers['ETag'] = etag
        if not response.headers.get('Cache-Control'):
            # 保存はさせるが、出す前に必ずサーバーへ確認させる(古いまま表示させない)
            response.headers['Cache-Control'] = 'private, no-cache'
        if _matches(request.headers.get('If-None-Match'), etag):
            response.status_code = 304
            response.set_data(b'')
        return response
