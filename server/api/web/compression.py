"""レスポンス圧縮 (gzip)。

一覧APIは同じ形のJSONが並ぶので非常によく縮む(実測: 予約 2.17MB→289KB、
録画 1.70MB→89KB、アルバム 320KB→47KB)。一覧は30秒ごとにポーリングされるため
効果が大きい。クライアントのソース(jsx/js)も no-store 配信で毎回落ちるので一緒に縮める。
"""

import gzip

from quart import request

_TYPES = ('application/json', 'text/', 'application/javascript',
          'application/xml', 'image/svg+xml')
_MIN_BYTES = 1024                  # これ未満は gzip ヘッダの方が大きい
_MAX_BYTES = 16 * 1024 * 1024      # 巨大なものはメモリに載せない
_LEVEL = 4                         # level6 とサイズはほぼ同じで CPU は 1/3(実測)
# 実体をメモリに持っている応答だけ触る。動画配信やHLSは生成しながら流す(IterableBody)ため、
# get_data() すると全部バッファしてしまう
_BODIES = ('DataBody', 'FileBody', 'IOBody')


def _is_target(response) -> bool:
    ctype = (response.content_type or '').split(';')[0].strip()
    if ctype == 'text/event-stream':      # SSE は流し続けるので触らない
        return False
    if type(response.response).__name__ not in _BODIES:
        return False
    # .jsx は拡張子が未知で application/octet-stream になるが中身はテキスト
    if request.path.startswith('/src/'):
        return True
    return any(ctype.startswith(t) for t in _TYPES)


def install(app) -> None:
    """アプリに gzip の after_request を登録する。"""

    @app.after_request
    async def gzip_response(response):
        if response.status_code != 200 or response.headers.get('Content-Encoding'):
            return response
        if not _is_target(response):
            return response
        # 同じURLで中身が変わるので、キャッシュに別物として持たせる
        vary = response.headers.get('Vary')
        if not vary:
            response.headers['Vary'] = 'Accept-Encoding'
        elif 'accept-encoding' not in vary.lower():
            response.headers['Vary'] = f'{vary}, Accept-Encoding'
        if 'gzip' not in (request.headers.get('Accept-Encoding') or ''):
            return response
        length = response.content_length
        if length is not None and not (_MIN_BYTES <= length <= _MAX_BYTES):
            return response
        data = await response.get_data()
        if not (_MIN_BYTES <= len(data) <= _MAX_BYTES):
            return response
        response.set_data(gzip.compress(data, _LEVEL))
        response.headers['Content-Encoding'] = 'gzip'
        return response
