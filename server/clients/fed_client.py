"""federation の push クライアント — リモートノードからライブラリサーバーへ
エンコード成果物(mp4/tag.json/サムネ2種)を HTTP で転送し video.db に登録させる。

同期 requests を使う（amatsukaze_api.py と同じ流儀）。エンコードの実行ワーカーのスレッドから
同期的に呼ばれるため async にする必要はない。
"""

import json
import os
import threading
import uuid
from urllib.parse import quote

import requests

# push全体をプロセス内で直列化するロック。ライブラリの手動移動(relocate)・エンコードの実行の
# file_copy push等が同時に走ると並列転送で帯域を食い合うため、必ず1本ずつ転送する。
_PUSH_LOCK = threading.Lock()


class FedPushError(Exception):
    pass


# キャプチャ画像の転送ファイル名プレフィックス。mp4/tag/サムネと区別するため
# (受信側 fed_routes._classify_file と対で使う)。
CAPTURE_PREFIX = 'capture__'


class FedClient:
    def __init__(self, fed_cfg: dict):
        peer = (fed_cfg or {}).get('library_peer') or {}
        self.base_url = (peer.get('url') or '').rstrip('/')
        self.verify = peer.get('verify_tls', True)
        self.session = requests.Session()
        # library_peer 固有のトークンがあればそれを使い、無ければ共通トークン
        self.session.headers['X-Fed-Token'] = peer.get('fed_token') or (fed_cfg or {}).get('fed_token') or ''

    def push_video(self, tag_dst_path: str, captures: list = None,
                   capture_dir: str = None, src_files: dict = None) -> int:
        """コピー後(dst側)の tag.json を読み、mp4/tag.json/サムネ2種をライブラリサーバーへ
        push して登録する。戻り値: ライブラリサーバー側の video_id。失敗時は例外を送出し、
        best-effort でステージングを掃除する。

        src_files: {tagフィールド名(app_output_path/thumbnail_path/thumbnail_tile_path):
        実ローカルファイルパス} のオーバーライド。直接push(tmpのcut.*を意図した話数名で
        送る)用。指定時はアップロード元をこのパスにし、アップロード名(=受信側の配置名)は
        tagのフィールド値の basename を使う。未指定時は tag のフィールド値をそのまま使う。

        captures: video.db capturesテーブルの行dictのリスト。指定時はキャプチャ画像も
        CAPTURE_PREFIX付きファイル名で転送し、メタデータをfinalizeに同梱して受信側で
        新video_idに紐づけて登録させる。capture_dir: 画像の置き場(行のpathはファイル名のみ)。"""
        if not self.base_url:
            raise FedPushError('library_peer.url が設定されていません')

        with open(tag_dst_path, encoding='utf-8') as f:
            tag = json.load(f)
        src_files = src_files or {}

        # 配置名は tag['app_output_path'] の basename、アップロード元は src_files の
        # オーバーライド(あれば)。これにより tmp の cut.mp4 を「話数名」で送れる。
        mp4_dest = tag.get('app_output_path')
        mp4_local = src_files.get('app_output_path') or mp4_dest
        if not mp4_dest or not mp4_local or not os.path.exists(mp4_local):
            raise FedPushError(f'mp4 が見つかりません: {mp4_local}')

        # tagのアップロード名はローカルの一時ファイル名(*.push_tmp.json等)に依存せず
        # 常に「<mp4名>.tag.json」に固定する。受信側の_classify_file/_finalize_syncは
        # この名前を必須とするため、一時tag名のままだとmp4本体2つと誤分類され400になる。
        files = [(os.path.basename(mp4_dest), mp4_local),
                 (os.path.basename(mp4_dest) + '.tag.json', tag_dst_path)]
        for key in ('thumbnail_path', 'thumbnail_tile_path'):
            dest = tag.get(key)
            local = src_files.get(key) or dest
            if dest and local and os.path.exists(local):
                files.append((os.path.basename(dest), local))

        cap_meta = []
        for row in (captures or []):
            fname = os.path.basename(str(row.get('path') or ''))
            if not fname:
                continue
            p = os.path.join(capture_dir, fname) if capture_dir else fname
            if not os.path.exists(p):
                continue
            files.append((CAPTURE_PREFIX + fname, p))
            cap_meta.append({k: row.get(k) for k in (
                'path', 'tot', 'onid', 'tsid', 'sid', 'eid',
                'eit_title', 'eit_description', 'eit_extended_info',
                'eit_start_time', 'eit_end_time', 'eit_station_name', 'owner')})

        transfer_id = uuid.uuid4().hex
        with _PUSH_LOCK:
            try:
                self._start(transfer_id, [(n, os.path.getsize(p)) for n, p in files])
                for name, p in files:
                    self._put_file(transfer_id, name, p)
                return self._finalize(transfer_id, tag, cap_meta)
            except Exception:
                self._abort(transfer_id)
                raise

    def _start(self, transfer_id: str, files: list) -> None:
        body = {'transfer_id': transfer_id,
                'files': [{'name': n, 'size': s} for n, s in files]}
        resp = self.session.post(f'{self.base_url}/api/fed/ingest/start', json=body,
                                  timeout=(10, 30), verify=self.verify)
        resp.raise_for_status()

    def _put_file(self, transfer_id: str, name: str, path: str) -> None:
        with open(path, 'rb') as f:
            resp = self.session.put(
                f'{self.base_url}/api/fed/ingest/{transfer_id}/file/{quote(name, safe="")}',
                data=f, timeout=(10, 7200), verify=self.verify)
        resp.raise_for_status()

    def _finalize(self, transfer_id: str, tag: dict, captures: list = None) -> int:
        body = {'tag': tag}
        if captures:
            body['captures'] = captures
        resp = self.session.post(
            f'{self.base_url}/api/fed/ingest/{transfer_id}/finalize',
            json=body, timeout=(10, 300), verify=self.verify)
        resp.raise_for_status()
        return resp.json()['video_id']

    def _abort(self, transfer_id: str) -> None:
        try:
            self.session.delete(f'{self.base_url}/api/fed/ingest/{transfer_id}',
                                 timeout=(10, 30), verify=self.verify)
        except requests.RequestException:
            pass

    def notify_encoding_started(self, event: dict) -> None:
        """エンコードキュー投入の通知(waiting(<node>)表示用)。best-effort。

        event: {onid, tsid, sid, eid, eit_start_time, node}
        """
        try:
            self.session.post(f'{self.base_url}/api/fed/encoding_started',
                              json=event, timeout=(5, 15), verify=self.verify)
        except requests.RequestException:
            pass
