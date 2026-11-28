"""サーバー間連携（federation） — UIから他ノードのAPIを閲覧・操作するための中継。

`fed_routes.py`(video転送のingest用)とは別の目的:こちらはブラウザ(ログイン済みユーザー)が
自分のノードのUIから、ペア登録したノードの番組表・予約・自動予約・録画/エンコード一覧を
そのまま閲覧・操作するためのプロキシ。認証は通常の api blueprint と同じ JWT cookie
(`ea_token`)。転送先ノードへは `X-Fed-Token`（federation.fed_token、両ノード共通の
共有シークレット）で認証する。転送先で受け付けるパスは `routes.py` の `_FED_ALLOWED`
ホワイトリストと同一のものをここでも適用し、オープンプロキシ化を防ぐ。
"""

import asyncio
import json
import logging
import re

import requests
from quart import Blueprint, Response, current_app, jsonify, request

from api.routes.access_rules import _FED_ALLOWED
from logic.federation import fed_auth
from .node_timeouts import _read_timeout_for

logger = logging.getLogger(__name__)

node_bp = Blueprint('nodes', __name__, url_prefix='/api/nodes')


# 中継用の接続を使い回す。
#
# 毎回 requests.request(...) を呼ぶと呼び出しごとに新しい接続になり、そのたびに
# TLS ハンドシェイクが起きる。相手は Akebi の keyless TLS で、握手のたびに外部の
# 鍵サーバーへ問い合わせるため、冷えた状態の1回目が数秒〜十数秒かかっていた
# （実測: 1回目 5.3〜16.0 秒 / 2回目以降 0.15〜0.21 秒）。押しても反応が無い、の
# 正体がこれ。Session を持てば接続が生き続け、2回目以降の速さが常態になる。
_SESSION = requests.Session()
_SESSION.mount('https://', requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=16))
_SESSION.mount('http://', requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=16))


@node_bp.before_request
async def _require_auth():
    from api.auth_routes.auth import request_authenticated
    if not request_authenticated():
        return jsonify({'error': 'Unauthorized'}), 401
    return None


def _perm():
    from api.auth_routes.auth import current_user
    from logic import perms
    return perms.of(current_user(), current_app.config['USERS_DB'])


def _known_peers(cfg: dict) -> dict:
    """name → {url, verify_tls}。library_peer(送信先)とremote_nodes(受信側が登録した
    送信側)を統合した「閲覧可能なピア一覧」を返す。"""
    fed = cfg.get('federation') or {}
    peers = {}
    lp = fed.get('library_peer') or {}
    if lp.get('url'):
        peers[lp.get('name') or 'library'] = lp
    for n in (fed.get('remote_nodes') or []):
        if n.get('url') and n.get('name'):
            peers[n['name']] = n
    return peers


@node_bp.get('')
async def list_nodes():
    """UI向け: このノードの役割と、閲覧可能なピア一覧を返す。"""
    p = _perm()
    fed = (current_app.config['ENCODE_AUTO'].get('federation') or {})
    role = 'sender' if (fed.get('library_peer') or {}).get('url') else \
        ('receiver' if fed.get('fed_token') else 'standalone')
    lp_name = (fed.get('library_peer') or {}).get('name') or 'library'
    return jsonify({
        'node_id': fed.get('node_id'),
        'role': role,
        'nodes': [{'name': name} for name in _known_peers(current_app.config['ENCODE_AUTO'])
                  if p.node(name)],
        # エンコード済みの動画を送る先(マスター)。ライブラリの多くはそちらにある
        'library_peer': lp_name if role == 'sender' and p.node(lp_name) else None,
    })


@node_bp.route('/<name>/<path:subpath>', methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
async def node_proxy(name, subpath):
    """ピア <name> の /api/<subpath> へリクエストを中継する。routes.py と同じ
    ホワイトリスト(_FED_ALLOWED)でのみ許可し、設定変更等の管理APIへは中継しない。
    レスポンスは全面ストリーミング中継する(JSON/バイナリで分岐しない単一コードパス)。
    録画再生のHLSセグメント/video_stream(ffmpegのオンデマンドエンコード応答、無限長になり
    うる)を全バッファリングすると待たされる/メモリを圧迫するため、requestsのstream=True
    をそのままQuartのストリーミングResponseへ橋渡しする。JSON等の小さい応答も実質1回の
    チャンクで返るだけで挙動は変わらない。"""
    cfg = current_app.config['ENCODE_AUTO']
    peer = _known_peers(cfg).get(name)
    if not peer:
        return jsonify({'error': f'未知のノード: {name}'}), 404
    p = _perm()
    if not p.node(name):
        return jsonify({'error': f'このサーバーは許可されていません: {name}'}), 403
    if request.method != 'GET' and not p.can_write:
        from api.routes.access_rules import _READONLY_OK
        if not any(request.method in m and rx.match(f'/api/{subpath}') for m, rx in _READONLY_OK):
            return jsonify({'error': 'この操作は許可されていません（閲覧のみ）'}), 403

    target_path = f'/api/{subpath}'
    if not any(request.method in methods and rx.match(target_path) for methods, rx in _FED_ALLOWED):
        return jsonify({'error': f'このAPIはノード間連携では許可されていません: {target_path}'}), 403

    # 管理者限定API(設定など)は中継でも管理者限定にする。routes.py の before_request は
    # 実パス(/api/nodes/<name>/...)で判定するため _ADMIN_ONLY に当たらず、ここで見ないと
    # 一般利用者がピアの設定を書き換えられてしまう（相手側は X-Fed-Token を管理者相当として通す）。
    from api.routes.access_rules import _ADMIN_ONLY
    if _ADMIN_ONLY.match(target_path) and not p.is_admin:
        return jsonify({'error': 'この設定は管理者のみ変更できます'}), 403

    # 番組表のアドオンは利用者ごとの許可（guides）。相手は中継を管理者として通すので、ここで見る
    gm = re.match(r'^/api/addons/([^/]+)/guide$', target_path)
    if gm and not p.guide(gm.group(1)):
        return jsonify({'error': 'この番組表は許可されていません'}), 403
    # キャプチャの持ち主（アカウントごとに見せる）も付ける。相手でもこの利用者の物だけを出す
    from api.stream_routes.capture_owner import me as capture_owner
    _perms_header = json.dumps({**p.to_json(), 'user': capture_owner()})

    url = f"{peer['url'].rstrip('/')}{target_path}"
    body = await request.get_data()
    qs = request.query_string.decode()
    read_timeout = _read_timeout_for(target_path)

    # ヘッダに載せる値は中継スレッドの外で作る（リクエスト文脈が要るため）。
    # ensure_ascii は落とさない。HTTP ヘッダは latin-1 なので、カテゴリ名に
    # 日本語が入っていると UnicodeEncodeError で中継そのものが 500 になる。
    # \uXXXX 形式なら純 ASCII で、受け側の json.loads がそのまま戻す。
    from api.routes.auth import private_cats
    _priv_cats_header = json.dumps(private_cats())

    def _do():
        return _SESSION.request(
            request.method, url,
            params=qs or None,
            data=body or None,
            headers={
                'X-Fed-Token': fed_auth.token_for_peer(cfg, peer),
                # 非公開カテゴリは中継元(このサーバー)の利用者設定なので、相手は
                # 判断できない。送らないと相手のライブラリで非公開が丸見えになる。
                # プライベートモード(?private=1)では空になり、従来どおり見える
                'X-Fed-Private-Cats': _priv_cats_header,
                # 相手は中継を管理者として通すので、この利用者の権限を渡して相手でも絞らせる
                # （局・画面・番組表のアドオン・NG カテゴリ。logic/perms.py の to_json）
                'X-Fed-Perms': _perms_header,
                'Content-Type': request.headers.get('Content-Type', 'application/json'),
                # 相手の gzip をそのまま中継する（展開せずに流すので Content-Length と合う）。
                # 無圧縮を頼んでいた頃は、一覧が 3〜4 倍の大きさで届き、サーバーを切り替えた
                # 時の読み込みが遅かった（予約: 104KB → 381KB）
                'Accept-Encoding': 'gzip' if 'gzip' in (request.headers.get('Accept-Encoding') or '') else 'identity',
                # ローカル保存の途中再開(Range/If-Range)。転送しないと相手は常に全体を
                # 返すため、中断した保存を続きから取り直せない。
                # If-None-Match は一覧の 304（変わっていなければ本文無し）を相手まで届けるため
                **{k: request.headers[k] for k in ('Range', 'If-Range', 'If-None-Match') if request.headers.get(k)},
            },
            timeout=(3, read_timeout),
            verify=peer.get('verify_tls', True),
            stream=True,
        )

    try:
        r = await asyncio.to_thread(_do)
    except requests.RequestException as e:
        logger.warning('node_proxy: node=%s path=%s failed: %s', name, target_path, e)
        return jsonify({'error': f'ノード {name} に接続できません: {e}'}), 502

    # ETag/Accept-Ranges/Content-Range はローカル保存のレジューム判定に、
    # Content-Disposition はダウンロード時のファイル名に必要
    passthru = {k: v for k, v in r.headers.items()
                if k.lower() in ('content-type', 'cache-control', 'content-length',
                                 'x-accel-buffering', 'etag', 'accept-ranges',
                                 'content-range', 'content-disposition',
                                 'content-encoding', 'vary')}

    # 圧縮されたまま流す（iter_content は gzip を展開してしまう）
    it = r.raw.stream(65536, decode_content=False)
    _END = object()

    async def _body():
        try:
            while True:
                chunk = await asyncio.to_thread(next, it, _END)
                if chunk is _END:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(r.close)

    return Response(_body(), status=r.status_code, headers=passthru)
