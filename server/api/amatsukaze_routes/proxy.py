"""決まった形の中継（呼んで返すだけの API の表）"""

from quart import jsonify
from api.routes.auth import bp  # noqa: F401
from api.routes.media import _amz  # noqa: F401
from api.routes.caches import _json  # noqa: F401
from .amz_call import _amz_call  # noqa: F401


# ── 決まった形の中継 ─────────────────────────────────────────────────
# Amatsukaze のメソッドを呼んで返すだけの API。1行に (メソッド, URL, 関数名, 呼ぶメソッド, 指定) で並べる。
#   URL の <...> の値を順に渡す。指定 {'body': True} なら最後に本文(JSON)も渡し、
#   {'ok': True} なら結果でなく {'ok': True} を返す。
# 本文を読まないものは同期の関数にする（Quart が別スレッドで動かすので、Amatsukaze への通信で
# サーバー全体を止めない。元の1関数ずつだった頃と同じ動き方）。
_PROXY_ROUTES = [
    # --- System ---
    ('get', '/amatsukaze/snapshot', 'amz_snapshot', 'get_snapshot'),
    ('get', '/amatsukaze/system', 'amz_system', 'get_system'),
    ('get', '/amatsukaze/server-env', 'amz_server_env', 'get_server_env'),
    ('get', '/amatsukaze/info/summary', 'amz_info_summary', 'get_info_summary'),
    ('get', '/amatsukaze/info/disks', 'amz_info_disks', 'get_info_disks'),
    ('get', '/amatsukaze/info/latest-release', 'amz_latest_release', 'get_latest_release'),
    ('get', '/amatsukaze/ui-state', 'amz_ui_state', 'get_ui_state'),
    ('post', '/amatsukaze/system/end', 'amz_end_server', 'end_server'),
    ('post', '/amatsukaze/system/cancel-sleep', 'amz_cancel_sleep', 'cancel_sleep'),
    ('post', '/amatsukaze/queue/cancel-add', 'amz_cancel_add_queue', 'cancel_add_queue'),
    # --- Logs ---
    ('get', '/amatsukaze/logs/encode', 'amz_encode_logs', 'get_encode_logs'),
    ('get', '/amatsukaze/logs/check', 'amz_check_logs', 'get_check_logs'),
    ('get', '/amatsukaze/profile-options', 'amz_profile_options', 'get_profile_options'),
    ('post', '/amatsukaze/profiles', 'amz_add_profile', 'add_profile', {'body': True}),
    ('put', '/amatsukaze/profiles/<name>', 'amz_update_profile', 'update_profile', {'body': True}),
    ('delete', '/amatsukaze/profiles/<name>', 'amz_remove_profile', 'remove_profile', {'ok': True}),
    # --- Auto-select ---
    ('get', '/amatsukaze/autoselect', 'amz_get_auto_selects', 'get_auto_selects'),
    ('get', '/amatsukaze/autoselect/options', 'amz_auto_select_options', 'get_auto_select_options'),
    ('post', '/amatsukaze/autoselect', 'amz_add_auto_select', 'add_auto_select', {'body': True}),
    ('put', '/amatsukaze/autoselect/<name>', 'amz_update_auto_select', 'update_auto_select', {'body': True}),
    ('delete', '/amatsukaze/autoselect/<name>', 'amz_remove_auto_select', 'remove_auto_select', {'ok': True}),
    # --- Services / Logo ---
    ('get', '/amatsukaze/services', 'amz_get_services', 'get_services'),
    ('post', '/amatsukaze/services/update', 'amz_update_service', 'update_service', {'body': True}),
    ('post', '/amatsukaze/services/logo/rescan', 'amz_rescan_logo', 'rescan_logo'),
    ('get', '/amatsukaze/service-settings', 'amz_service_settings', 'get_service_settings'),
    ('get', '/amatsukaze/service-options', 'amz_service_options', 'get_service_options'),
    ('post', '/amatsukaze/service-settings/<int:service_id>/logos/no-logo', 'amz_add_no_logo', 'add_no_logo'),
    ('delete', '/amatsukaze/service-settings/<int:service_id>/logos/no-logo', 'amz_remove_no_logo', 'remove_no_logo', {'ok': True}),
    # --- DRCS ---
    ('get', '/amatsukaze/drcs', 'amz_get_drcs', 'get_drcs'),
    ('post', '/amatsukaze/drcs', 'amz_add_drcs', 'add_drcs', {'body': True}),
    ('delete', '/amatsukaze/drcs/map/<md5>', 'amz_delete_drcs_map', 'delete_drcs_map', {'ok': True}),
    ('get', '/amatsukaze/drcs/appearance/<md5>', 'amz_drcs_appearance', 'get_drcs_appearance'),
    # --- Settings ---
    ('get', '/amatsukaze/settings', 'amz_get_settings', 'get_settings'),
    ('get', '/amatsukaze/settings/options', 'amz_settings_options', 'get_settings_options'),
    ('put', '/amatsukaze/settings', 'amz_update_settings', 'update_settings', {'body': True}),
    ('get', '/amatsukaze/makescript', 'amz_get_makescript', 'get_makescript'),
    ('put', '/amatsukaze/makescript', 'amz_update_makescript', 'update_makescript', {'body': True}),
    ('get', '/amatsukaze/batfiles/addqueue', 'amz_batfiles_addqueue', 'get_batfiles_addqueue'),
    ('get', '/amatsukaze/batfiles/queuefinish', 'amz_batfiles_queuefinish', 'get_batfiles_queuefinish'),
    ('get', '/amatsukaze/makescript/preview', 'amz_get_makescript_preview', 'get_makescript_preview'),
    ('put', '/amatsukaze/finish-setting', 'amz_update_finish_setting', 'update_finish_setting', {'body': True}),
    # --- Console ---
    ('get', '/amatsukaze/console/<int:task_id>', 'amz_get_console', 'get_console'),
    ('get', '/amatsukaze/logo/analyze/<job_id>', 'amz_logo_analyze_status', 'get_logo_analyze_status'),
    ('post', '/amatsukaze/logo/analyze/<job_id>/apply', 'amz_apply_logo_analyze', 'apply_logo_analyze'),
    ('post', '/amatsukaze/logo/analyze/<job_id>/discard', 'amz_discard_logo_analyze', 'discard_logo_analyze'),
    ('delete', '/amatsukaze/logo/preview/sessions/<session_id>', 'amz_delete_logo_preview_session', 'delete_logo_preview_session', {'ok': True}),
    ('delete', '/amatsukaze/trim/sessions/<session_id>', 'amz_delete_trim_session', 'delete_trim_session', {'ok': True}),
    ('delete', '/amatsukaze/trim/tempdir/<int:queue_item_id>', 'amz_delete_trim_tempdir', 'delete_trim_tempdir', {'ok': True}),
]


def _register_proxy(method, rule, endpoint, call, body=False, ok=False, doc=None):
    def _respond(args):
        result = _amz_call(getattr(_amz(), call), *args)
        return jsonify({'ok': True} if ok else result)

    if body:
        async def view(**kw):
            return _respond([*kw.values(), await _json()])
    else:
        def view(**kw):
            return _respond(list(kw.values()))
    view.__name__ = view.__qualname__ = endpoint
    view.__doc__ = doc
    getattr(bp, method)(rule)(view)


# API の一覧の画面に出す説明（Amatsukaze の同じ名前の操作をそのまま呼ぶ）
_PROXY_DOCS = {
    'amz_snapshot': 'Amatsukaze の今の状態（キュー・設定などをまとめた物）',
    'amz_system': 'Amatsukaze のシステムの情報',
    'amz_server_env': 'Amatsukaze が動いている環境の情報',
    'amz_info_summary': 'Amatsukaze の情報の要約',
    'amz_info_disks': 'Amatsukaze から見えるディスクの空き',
    'amz_latest_release': 'Amatsukaze の最新の版（新しい版が出ているか）',
    'amz_ui_state': 'Amatsukaze の画面の状態',
    'amz_end_server': 'Amatsukaze のサーバーを終わらせる',
    'amz_cancel_sleep': 'Amatsukaze のエンコード後のスリープを取りやめる',
    'amz_cancel_add_queue': 'Amatsukaze のキューへの追加を取りやめる',
    'amz_encode_logs': 'Amatsukaze のエンコードの記録（全部）',
    'amz_check_logs': 'Amatsukaze の確認（チェック）の記録（全部）',
    'amz_profile_options': 'プロファイルで選べる値の一覧',
    'amz_add_profile': 'プロファイルを足す（本文がプロファイル）',
    'amz_update_profile': 'プロファイルを変える（本文がプロファイル）',
    'amz_remove_profile': 'プロファイルを消す',
    'amz_get_auto_selects': 'プロファイルの自動選択のルールの一覧',
    'amz_auto_select_options': '自動選択で選べる値の一覧',
    'amz_add_auto_select': '自動選択のルールを足す（本文がルール）',
    'amz_update_auto_select': '自動選択のルールを変える（本文がルール）',
    'amz_remove_auto_select': '自動選択のルールを消す',
    'amz_get_services': 'Amatsukaze が知っている局の一覧',
    'amz_update_service': '局の設定を変える（本文が設定）',
    'amz_rescan_logo': 'ロゴのフォルダを読み直す',
    'amz_service_settings': '局ごとの設定（ロゴなど）',
    'amz_service_options': '局の設定で選べる値の一覧',
    'amz_add_no_logo': '局を「ロゴ無し」にする',
    'amz_remove_no_logo': '局の「ロゴ無し」をやめる',
    'amz_get_drcs': 'DRCS（字幕の外字）の一覧',
    'amz_add_drcs': 'DRCS を足す（本文が DRCS）',
    'amz_delete_drcs_map': 'DRCS の置き換え文字を消す',
    'amz_drcs_appearance': 'DRCS が出てくる番組（どこで使われているか）',
    'amz_get_settings': 'Amatsukaze の設定',
    'amz_settings_options': '設定で選べる値の一覧',
    'amz_update_settings': 'Amatsukaze の設定を変える（本文が設定）',
    'amz_get_makescript': 'エンコードを依頼するスクリプトの設定',
    'amz_update_makescript': 'エンコードを依頼するスクリプトの設定を変える（本文が設定）',
    'amz_batfiles_addqueue': 'キューへ足す時に動かすバッチの一覧',
    'amz_batfiles_queuefinish': 'キューが終わった時に動かすバッチの一覧',
    'amz_get_makescript_preview': '今の設定でのスクリプトの中身',
    'amz_update_finish_setting': 'キューが終わった時の動き（スリープなど）を変える（本文が設定）',
    'amz_get_console': 'エンコードのコンソール出力（全部）',
    'amz_logo_analyze_status': 'ロゴの解析の進み具合',
    'amz_apply_logo_analyze': 'ロゴの解析でできたロゴを局に登録する',
    'amz_discard_logo_analyze': 'ロゴの解析の結果を捨てる',
    'amz_delete_logo_preview_session': 'ロゴを重ねて見るための準備を片付ける',
    'amz_delete_trim_session': 'トリムの編集の準備を片付ける',
    'amz_delete_trim_tempdir': 'トリムの編集で作った作業フォルダを消す',
}


for _method, _rule, _endpoint, _call, *_opts in _PROXY_ROUTES:
    _register_proxy(_method, _rule, _endpoint, _call,
                    doc=f'{_PROXY_DOCS.get(_endpoint, _call)}（Amatsukaze の {_call} を中継）。',
                    **(_opts[0] if _opts else {}))
