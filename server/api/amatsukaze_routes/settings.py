"""プロファイル・ロゴ・DRCS・スクリプト・コンソール・ロゴ解析・トリム"""

from quart import jsonify, request, abort
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _amz  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from .amz_call import _amz_call  # noqa: F401


# --- Profiles ---

@bp.get('/amatsukaze/profiles')
def amz_get_profiles():
    """Amatsukaze のプロファイル一覧。?url= で別の Amatsukaze サーバーを指定できる。"""
    url = request.args.get('url')
    if url:
        from clients.amatsukaze_api.core import AmatsukazeClient
        client = AmatsukazeClient(url)
        return jsonify(_amz_call(client.get_profiles))
    return jsonify(_amz_call(_amz().get_profiles))


@bp.post('/amatsukaze/services/logo')
def amz_upload_logo():
    """ロゴファイル（.lgd）を Amatsukaze へ登録する。multipart: image（必須）・serviceId・imgw・imgh。"""
    f = request.files.get('image')
    if not f:
        abort(400, description='image file required')
    result = _amz_call(
        _amz().upload_logo,
        f.read(),
        filename=f.filename or 'logo.lgd',
        service_id=request.form.get('serviceId', type=int),
        imgw=request.form.get('imgw', type=int),
        imgh=request.form.get('imgh', type=int),
    )
    return jsonify(result)


@bp.post('/amatsukaze/services/logo/probe')
def amz_probe_logo():
    """ロゴファイル（.lgd）を登録せずに読み、中身（サイズ・局など）を返す。multipart: image。"""
    f = request.files.get('image')
    if not f:
        abort(400, description='image file required')
    return jsonify(_amz_call(_amz().probe_logo, f.read(), filename=f.filename or 'logo.lgd'))


@bp.put('/amatsukaze/service-settings/<int:service_id>/logos/period')
async def amz_update_logo_period(service_id):
    """局のロゴの有効期間を変える。body: {fileName, from, to}。"""
    body = await _json()
    result = _amz_call(
        _amz().update_logo_period,
        service_id,
        body['fileName'],
        body['from'],
        body['to'],
    )
    return jsonify(result)


@bp.put('/amatsukaze/service-settings/<int:service_id>/logos/enabled')
async def amz_update_logo_enabled(service_id):
    """局のロゴを使うか（有効・無効）を切り替える。body: {fileName, enabled}。"""
    body = await _json()
    result = _amz_call(_amz().update_logo_enabled, service_id, body['fileName'], body['enabled'])
    return jsonify(result)


@bp.delete('/amatsukaze/service-settings/<int:service_id>/logos')
async def amz_delete_logo(service_id):
    """局のロゴを消す。body: {fileName}。"""
    body = await _json()
    _amz_call(_amz().delete_logo, service_id, body['fileName'])
    return jsonify({'ok': True})


@bp.put('/amatsukaze/drcs/map')
async def amz_update_drcs_map():
    """DRCS（字幕の外字）の置き換え文字を登録する。body: {md5, mapStr}。"""
    body = await _json()
    result = _amz_call(_amz().update_drcs_map, body['md5'], body['mapStr'])
    return jsonify(result)


@bp.post('/amatsukaze/makescript/preview')
async def amz_post_makescript_preview():
    """エンコードを依頼するスクリプトの中身を、指定の内容で作って返す（保存しない）。

    body: {makeScriptData, targetHost?, scriptType?（sh 既定）, remoteHost?, subnet?, mac?}
    """
    body = await _json()
    result = _amz_call(
        _amz().post_makescript_preview,
        body['makeScriptData'],
        target_host=body.get('targetHost', 'local'),
        script_type=body.get('scriptType', 'sh'),
        remote_host=body.get('remoteHost'),
        subnet=body.get('subnet'),
        mac=body.get('mac'),
    )
    return jsonify(result)


@bp.post('/amatsukaze/makescript/file')
async def amz_post_makescript_file():
    """エンコードを依頼するスクリプトを、ファイルの中身（テキスト）として返す。body はプレビューと同じ。"""
    body = await _json()
    from quart import Response
    text = _amz_call(
        _amz().post_makescript_file,
        body['makeScriptData'],
        target_host=body.get('targetHost', 'local'),
        script_type=body.get('scriptType', 'sh'),
        remote_host=body.get('remoteHost'),
        subnet=body.get('subnet'),
        mac=body.get('mac'),
    )
    return Response(text, content_type='text/plain; charset=utf-8')


@bp.get('/amatsukaze/console/<int:task_id>/changes')
def amz_console_changes(task_id):
    """Amatsukaze のエンコードのコンソール出力のうち、?since=（必須）より後の分を返す。"""
    since = request.args.get('since', type=int)
    if since is None:
        abort(400, description='since parameter required')
    return jsonify(_amz_call(_amz().get_console_changes, task_id, since))


# --- Logo analyze ---


# --- Trim ---


# --- Path suggest ---

@bp.get('/amatsukaze/path/suggest')
def amz_path_suggest():
    """Amatsukaze から見えるフォルダ・ファイルの候補（パス入力の補完用）。

    ?input=, ext, maxDirs, maxFiles, allowFiles, allowDirs, checkAccess, dirOffset, fileOffset
    """
    result = _amz_call(
        _amz().get_path_suggest,
        request.args.get('input', ''),
        ext=request.args.get('ext'),
        max_dirs=request.args.get('maxDirs', default=10, type=int),
        max_files=request.args.get('maxFiles', default=20, type=int),
        allow_files=request.args.get('allowFiles', 'true').lower() == 'true',
        allow_dirs=request.args.get('allowDirs', 'true').lower() == 'true',
        check_access=request.args.get('checkAccess', 'false').lower() == 'true',
        dir_offset=request.args.get('dirOffset', default=0, type=int),
        file_offset=request.args.get('fileOffset', default=0, type=int),
    )
    return jsonify(result)
