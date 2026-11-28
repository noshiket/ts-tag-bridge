"""録画設定の選択肢（プリセット・プラグイン・既定値）"""

from quart import jsonify
from api.routes.auth import bp
from api.routes.edcb_call import _client


@bp.get('/rec_setting_options')
def get_rec_setting_options():
    """EnumRecPreset?json=1 から録画設定プラグイン選択肢一覧を返す。"""
    import json as _js
    import urllib.request as _ur
    client = _client()
    if client.is_demo:
        return jsonify({'presets': [], 'writePlugIn': [], 'recNamePlugIn': [], 'batFilePath': []})
    try:
        url = f"{client.base_url}/api/EnumRecPreset?json=1"
        with _ur.urlopen(url, timeout=5) as resp:
            data = _js.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return jsonify({'error': str(e)}), 502

    items = data if isinstance(data, list) else data.get('items', [])
    # rec_setting(EDCB camelCase生値)を各プリセットに添付する。クライアントの
    # 録画設定フォームがプリセット選択時に全フィールドへ値を反映するために使う
    presets = [{'value': it['id'], 'label': it.get('name', str(it['id'])),
                'rec_setting': it.get('recSetting') or {}} for it in items]

    write_plugins, rec_name_plugins, bat_files = [], [], []
    seen_wp, seen_rp, seen_bf = set(), set(), set()
    default_rec_folder = ''
    default_write_plug_in = ''
    default_rec_name_plug_in = ''
    default_start_margin = None
    default_end_margin = None
    for it in items:
        rs = it.get('recSetting', {})
        folders = rs.get('recFolderList', [])
        for folder in folders:
            rf = folder.get('recFolder', '')
            if rf and not default_rec_folder:
                default_rec_folder = rf
            wp = folder.get('writePlugIn', '')
            if wp and not default_write_plug_in:
                default_write_plug_in = wp
            if wp and wp not in seen_wp:
                seen_wp.add(wp)
                write_plugins.append({'value': wp, 'label': wp})
            rp = folder.get('recNamePlugIn', '')
            if rp and not default_rec_name_plug_in:
                default_rec_name_plug_in = rp
            if rp and rp not in seen_rp:
                seen_rp.add(rp)
                rec_name_plugins.append({'value': rp, 'label': rp})
        if default_start_margin is None and rs.get('startMargin') is not None:
            default_start_margin = rs['startMargin']
        if default_end_margin is None and rs.get('endMargin') is not None:
            default_end_margin = rs['endMargin']
        bf = rs.get('batFilePath', '')
        if bf and bf not in seen_bf:
            seen_bf.add(bf)
            bat_files.append({'value': bf, 'label': bf})

    return jsonify({
        'presets':              presets,
        'writePlugIn':          write_plugins,
        'recNamePlugIn':        rec_name_plugins,
        'batFilePath':          bat_files,
        'defaultRecFolder':     default_rec_folder,
        'defaultWritePlugIn':   default_write_plug_in,
        'defaultRecNamePlugIn': default_rec_name_plug_in,
        'defaultStartMargin':   default_start_margin,
        'defaultEndMargin':     default_end_margin,
    })
