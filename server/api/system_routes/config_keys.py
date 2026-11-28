"""画面から変えてよい設定の項目（型・再起動が要るもの・ファイルでしか変えないもの）と伏せ字"""

_SECRET_MASK = '********'


# PATCH /api/config で変更可能なスカラーキー
_EDITABLE_SCALAR_KEYS = {
    'port', 'host', 'output_path', 'tmp_base',
    'phase_a_interval', 'phase_b_interval', 'phase_b_scan_interval', 'phase_c_interval',
    'phase_b_defer_recordings', 'phase_b_defer_during_encode', 'drop_debug', 'log_debug', 'log_file', 'log_file_path', 'data_dir',
    'encode_history_limit', 'program_retention_days', 'ffmpeg', 'ffprobe', 'jwt_secret',
    'auto_skip_duplicates',
    'cmcut_weight', 'audio_sync_weight',
    'cmcut_workers', 'cmcut_nice', 'cmcut_max_load',
    'audio_sync_nice', 'audio_sync_max_load',
    'mini_player_height',
}


_INT_KEYS = {
    'port', 'phase_a_interval', 'phase_b_interval', 'phase_b_scan_interval',
    'phase_c_interval', 'phase_b_defer_recordings', 'encode_history_limit',
    'program_retention_days', 'cmcut_workers', 'cmcut_nice', 'audio_sync_nice',
    'mini_player_height',
}


_BOOL_KEYS = {'phase_b_defer_during_encode', 'drop_debug', 'auto_skip_duplicates', 'log_debug', 'log_file'}


# リスト/dict として丸ごと置換するキー
_EDITABLE_COMPLEX_KEYS = {
    'edcb_servers', 'amatsukaze_servers', 'services', 'volumes',
    'text_parser_context', 'encode_dir_list', 'tmp_base_list',
}


# ドットパスで部分更新するネストキー（値の型変換関数。None はキー削除）
_EDITABLE_NESTED_PATHS = {
    'https.enabled': lambda v: v if isinstance(v, bool) else str(v).lower() == 'true',
    'https.backend_port': int,
    'https.keyless_server_url': str,
    'https.akebi_path': str,
    'https.custom_certificate': str,
    'https.custom_private_key': str,
    'streaming.edcb_server': str,
    'streaming.encoder': str,
    'streaming.max_alive_time': int,
    'streaming.ffmpeg': str,
    'streaming.ffprobe': str,
    'federation.node_id': str,
    'federation.fed_token': str,
    'federation.library_peer': lambda v: v,  # dict 丸ごと（設定/解除）
    'federation.library_peer.name': str,
    'federation.library_peer.url': str,
    'federation.library_peer.verify_tls': lambda v: v if isinstance(v, bool) else str(v).lower() == 'true',
    'federation.library_peer.fed_token': str,
    'federation.remote_nodes': lambda v: v,  # list 丸ごと（受信側が閲覧したい送信側ノードの登録）
}


# ファイルにのみ書き込み、稼働中メモリには反映しないキー（即時反映すると危険なもの）
_FILE_ONLY_KEYS = {'jwt_secret'}


# 反映に再起動が必要なキー（プレフィックス一致も含む）
_RESTART_KEYS = {
    'port', 'host', 'phase_c_interval', 'phase_b_defer_recordings',
    'phase_b_defer_during_encode', 'edcb_servers', 'amatsukaze_servers', 'jwt_secret',
    'data_dir',
}


_RESTART_PREFIXES = ('https.', 'streaming.')
