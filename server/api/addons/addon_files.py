"""アドオンが利用者へ渡すファイルの受け渡し（例: 切り抜きの MP4）。

ADDON に output_ttl_sec を書いたアドオンだけ。置き場所と片付けは logic/addons/addon_outputs。
"""

import os
from quart import abort, request, send_file
from api.routes.auth import bp
from api.routes.media import _DeleteAfterSend
from logic.addons import addon_outputs


@bp.get('/addons/<name>/files/<path:filename>')
async def download_addon_file(name, filename):
    """アドオンが作ったファイルを配る（送り切ったら消す）。

    端末へ保存されれば一時ファイルは不要なので、その場で回収する。
    途中で切れた分は再取得できるよう残し、寿命での片付けに任せる（ダウンロードの
    埋め込み一時ファイルと同じ扱い）。
    """
    if not addon_outputs.output_ttl(name):
        abort(404, description=f'アドオン {name} は渡すファイルを持ちません')
    fname = os.path.basename(filename)
    path = os.path.join(addon_outputs.output_dir(name), fname)
    if not os.path.isfile(path):
        abort(404, description='ファイルが見つかりません（作り直してください）')
    dl_name = request.args.get('name') or fname
    response = await send_file(path, mimetype='application/octet-stream',
                               as_attachment=True, attachment_filename=dl_name,
                               conditional=True)
    response.timeout = None
    if response.status_code == 200:
        response.response = _DeleteAfterSend(response.response, path)
    return response
