#!/usr/bin/env python3
"""EDCB API クライアント

Usage:
    from clients.edcb_api import EDCBClient
    client = EDCBClient("http://localhost:5510")
    services = client.enum_service()
    reserves = client.enum_reserve_info()
"""




BASE_URL = "http://localhost:5510"

# CSRF トークン取得ページ: endpoint_name -> (path, regex)
_CSRF_PAGES: dict[str, tuple[str, str]] = {
    'setreserve': ('/EMWUI/reserve.html',                  r"ctok='([a-f0-9]{32})'"),
    'setautoadd': ('/EMWUI/autoaddepginfo.html?id=0',      r'name="ctok" value="([a-f0-9]{32})"'),
    'setmanuadd': ('/EMWUI/autoaddmanualinfo.html?id=0',   r'name="ctok" value="([a-f0-9]{32})"'),
    'common':     ('/EMWUI/epg.html',                      r'data-ctok="([a-f0-9]{32})"'),
    'searchevent': ('/EMWUI/search.html',                  r'id="api" value="([a-f0-9]{32})"'),
    'setrecinfo': ('/EMWUI/recinfo.html',                  r"ctok='([a-f0-9]{32})'"),
}

# GetRecSetting() が必須チェックするパラメータのデフォルト値
_REC_DEFAULTS = {
    'recEnabled':      1,   # 1=録画する
    'recMode':         1,   # 1=指定サービス
    'priority':        2,
    'suspendMode':     0,   # 0=録画後何もしない
    'tunerID':         0,   # 0=自動
    'tuijyuuFlag':     1,
    'useDefMarginFlag': 1,  # 1=デフォルトマージン使用（これがないとstartMargin/endMarginが必須になる）
    'batFileTag':      '',  # batFilePath存在時に#nilエラーを防ぐため常に空文字で送信
}

# bool 系フラグ: Lua では 0 が truthy のため、false 時はキー自体を省略する
# （0 を送ると EDCB 側の lua_toboolean で true に化ける）
_BOOL_REC_FLAGS = ('tuijyuuFlag', 'pittariFlag', 'rebootFlag', 'continueRecFlag')


def _normalize_bool_flags(params: dict) -> dict:
    """bool系フラグの正規化: falsy はキー削除、truthy は 1。

    0 を送ると SetReserve/SetAutoAdd の Lua 側で true に化ける
    (実測: pittariFlag=0 を送るとルールに pittari=ON が保存される)。
    """
    out = dict(params)
    for k in _BOOL_REC_FLAGS:
        if k in out:
            if out[k]:
                out[k] = 1
            else:
                del out[k]
    return out


def _rec_setting_to_post_params(rs: dict) -> dict:
    """EDCB の recSetting dict を SetReserve(HttpPublic) の POST フィールド形式へ変換する。
    プリセット / 既存予約のどちらの recSetting からでも使用できる。
    SetReserve の GetRecSetting は POST フィールドのみから録画設定を再構築する（フォールバック無し）
    ため、recFolder / 各プラグイン / batFilePath / 優先度 等を明示的に送る必要がある。
    """
    params = {
        'recMode':        rs.get('noRecMode', rs.get('recMode', 1)),
        'recEnabled':     1 if rs.get('recEnabled', True) else 0,
        'priority':       rs.get('priority', 2),
        'suspendMode':    rs.get('suspendMode', 0),
        'tunerID':        rs.get('tunerID', 0),
        'partialRecFlag': rs.get('partialRecFlag', 0),
        'batFileTag':     '',
    }
    for k in _BOOL_REC_FLAGS:
        if rs.get(k):
            params[k] = 1

    # マージン: startMargin/endMargin があれば指定、無ければデフォルトマージン使用
    if rs.get('startMargin') is not None and rs.get('endMargin') is not None:
        params['useDefMarginFlag'] = 0
        params['startMargin'] = rs['startMargin']
        params['endMargin'] = rs['endMargin']
    else:
        params['useDefMarginFlag'] = 1

    # serviceMode: GetRecSetting の逆変換（POST serviceMode==1 → stored 0、それ以外 → 1+16*sm1+32*sm2）
    sm = rs.get('serviceMode', 0)
    if sm == 0:
        params['serviceMode'] = 1
    else:
        params['serviceMode'] = 0
        params['serviceMode_1'] = (sm // 16) % 2
        params['serviceMode_2'] = (sm // 32) % 2

    # batFilePath ('path*tag' 形式を分離)
    bat = rs.get('batFilePath', '') or ''
    if '*' in bat:
        bat, tag = bat.split('*', 1)
        params['batFileTag'] = tag
    params['batFilePath'] = bat

    # recFolderList[0] → recFolder / writePlugIn / recNamePlugIn / recName
    # ファイル名オプションは EDCB のビルドにより recNameOp(独立フィールド) または
    # recNamePlugIn 内の '?引数' として返る。どちらでも拾い、空送信で消さないようにする
    folders = rs.get('recFolderList', [])
    if folders:
        f = folders[0]
        params['recFolder'] = f.get('recFolder', '')
        params['writePlugIn'] = f.get('writePlugIn', '')
        plug = f.get('recNamePlugIn', '') or ''
        rec_name = f.get('recNameOp', '') or ''
        if not rec_name and '?' in plug:
            plug, rec_name = plug.split('?', 1)
        params['recNamePlugIn'] = plug
        # GetRecSetting が #recName を参照するため、recNamePlugIn 送信時は recName を必ず付与する
        params['recName'] = rec_name

    return params
