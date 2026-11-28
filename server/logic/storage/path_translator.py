"""path_translator — Docker volume マッピングに基づくパス変換

各サービスの volumes は docker-compose と同じ [{host, target}, ...] のリスト。
最長プレフィックスマッチで変換する。
"""


def _translate(path: str, volumes: list, from_key: str, to_key: str) -> str:
    """volumes の中から最も具体的なマッピングを探してパスを変換する。"""
    best_prefix_len = -1
    result = path
    for vol in volumes:
        src = vol.get(from_key, '').rstrip('/')
        dst = vol.get(to_key, '').rstrip('/')
        if path == src or path.startswith(src + '/'):
            if len(src) > best_prefix_len:
                best_prefix_len = len(src)
                rel = path[len(src):]
                if not rel.startswith('/'):
                    rel = '/' + rel
                result = dst + rel
    return result


def container_to_host(container_path: str, volumes: list) -> str:
    """コンテナ内パス → ホスト絶対パス。"""
    return _translate(container_path, volumes, from_key='target', to_key='host')


def host_to_container(host_path: str, volumes: list) -> str:
    """ホスト絶対パス → コンテナ内パス。"""
    return _translate(host_path, volumes, from_key='host', to_key='target')


def to_container_path(path: str, volumes: list) -> str:
    """ホストのパスでもコンテナのパスでも受け取り、コンテナ内パスにして返す。

    録画詳細のエンコード設定では input_ts / dstPath を手で書ける。config.yml の tmp_base と
    同じくホストのパス（/mnt/ssd/raw/...）で書くと、そのまま Amatsukaze に渡って
    コンテナ内に無いパスになり、キュー登録が 400 で断られた。
    既にどれかのコンテナ側パス(target)の下ならそのまま返す。
    """
    if not path or not volumes:
        return path
    for vol in volumes:
        dst = (vol.get('target') or '').rstrip('/')
        if dst and (path == dst or path.startswith(dst + '/')):
            return path
    return host_to_container(path, volumes)


def _svc_volumes(config: dict, name: str) -> list:
    return config.get('services', {}).get(name, {}).get('volumes', [])


def translate_paths(edcb_path: str, config: dict) -> dict:
    """EDCB が返したパスを各環境向けパスに変換して辞書で返す。

    config の期待構造:
        services:
          edcb:
            volumes: [{host: /mnt, target: /mnt}, ...]
          amatsukaze:
            volumes: [{host: /, target: /host-rootfs}]
        volumes: []   # encode_auto 自身（ホスト動作なら空でよい）

    旧フラット形式 (edcb_root / Amatsukaze_root 等) は無視される。
    """
    edcb_vols = _svc_volumes(config, 'edcb')
    amz_vols  = _svc_volumes(config, 'amatsukaze')
    my_vols   = config.get('volumes', [])

    host_path = container_to_host(edcb_path, edcb_vols)

    return {
        'edcb_ts_path':       edcb_path,
        'host_ts_path':       host_path,
        'app_ts_path':        host_to_container(host_path, my_vols) if my_vols else host_path,
        'amatsukaze_ts_path': host_to_container(host_path, amz_vols),
    }
