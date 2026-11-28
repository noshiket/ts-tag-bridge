"""federation の共有シークレット(fed_token)の解決と照合。

トークンはノードごとに分けられる。`library_peer` / `remote_nodes[]` の各要素に
`fed_token` があればそれを使い、無ければ従来どおり共通の `federation.fed_token` を
使う（既存設定はそのまま動く）。

分ける意味: 共通トークン1本だと、スレーブを増やすほど「1台漏れると全ノードに通る」
状態になる。ノードごとに分けておけば、漏れた1台のトークンを差し替えるだけで済む。

  送信時: token_for_peer(cfg, peer) … その相手へ出すトークン
  受信時: verify(cfg, got)          … 受け取ったトークンが自分の知るどれかに一致するか
"""

import hmac


def _fed(cfg: dict) -> dict:
    return (cfg or {}).get('federation') or {}


def token_for_peer(cfg: dict, peer: dict) -> str:
    """peer へ送るトークン。peer 固有のものが無ければ共通トークン。"""
    return (peer or {}).get('fed_token') or _fed(cfg).get('fed_token') or ''


def accepted_tokens(cfg: dict) -> list:
    """受信時に受け付けるトークン一覧（共通 + 各ピア固有）。"""
    fed = _fed(cfg)
    out = []
    for t in [fed.get('fed_token'),
              *(((fed.get('library_peer') or {}).get('fed_token'),)),
              *((p or {}).get('fed_token') for p in (fed.get('remote_nodes') or []))]:
        if t:
            out.append(t)
    return out


def verify(cfg: dict, got: str) -> bool:
    """受け取った X-Fed-Token が受け付け対象のどれかに一致するか。"""
    if not got:
        return False
    # 一致しても回し切る（短絡すると一致位置がタイミングに出るため）
    ok = False
    for t in accepted_tokens(cfg):
        if hmac.compare_digest(got, t):
            ok = True
    return ok
