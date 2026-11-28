"""他のサーバーへ録画を送る（進み具合を数える読み口つき）"""

import os
from urllib.parse import quote
import requests
from .fed_client import FedPushError, _PUSH_LOCK


class _ProgressReader:
    """読んだぶんを数えながら渡すファイル。requests へそのまま渡せる。

    Content-Length を自分で付けるので、requests はチャンク送信ではなく
    そのまま読み切る（数GBを一度に読み込まない）。
    """

    def __init__(self, fp, total, tell, step=32 * 1024 * 1024):
        self._fp = fp
        self._total = total
        self._tell = tell
        self._step = step
        self._sent = 0
        self._next = step

    def read(self, size=-1):
        chunk = self._fp.read(size)
        if chunk:
            self._sent += len(chunk)
            if self._sent >= self._next:
                self._next = self._sent + self._step
                self._tell('sending', self._sent, self._total)
        return chunk

    def __len__(self):        # requests が長さを見るため
        return self._total


class FedNodeClient:
    """録画転送型の委譲エンコード用クライアント(マスター → remote_nodes のスレーブ)。

    録画そのもの(TS+メタ)をスレーブへ転送し、スレーブ側で通常録画として
    登録+自動キュー投入させる。認証は X-Fed-Token(FedClient と同じ)。
    """

    def __init__(self, node_cfg: dict, fed_token: str):
        self.base_url = (node_cfg.get('url') or '').rstrip('/')
        self.verify = node_cfg.get('verify_tls', True)
        self.session = requests.Session()
        self.session.headers['X-Fed-Token'] = fed_token or ''

    def transfer_recording(self, transfer_id: str, ts_path: str, meta: dict,
                           on_progress=None) -> dict:
        """TS+録画メタをスレーブへ転送する。戻り値: {'recording_id': int, ...}(スレーブ側)。

        冪等: スレーブは同一番組(onid/tsid/sid/eid/eit_start_time)の既存録画があれば
        転送済みとして既存idを返す。transfer_id は決定的な値を渡す(再送で上書き)。

        on_progress(phase, sent, total) を渡すと進み具合を知らせる。
        数GBを数分かけて送るので、これが無いと呼び出し側は終わるまで何も分からない。
        """
        def _tell(phase, sent=0, total=0):
            if on_progress:
                try:
                    on_progress(phase, sent, total)
                except Exception:
                    pass
        if not self.base_url:
            raise FedPushError('remote_nodes の url が設定されていません')
        name = os.path.basename(ts_path)
        size = os.path.getsize(ts_path)
        files = [{'name': name, 'size': size}]
        _tell('waiting', 0, size)      # 直列化の順番待ち(先に別の転送が走っていることがある)
        with _PUSH_LOCK:  # video push と帯域を食い合わないよう直列化
            try:
                # event識別子を同梱: スレーブに同一番組の録画が既にあればGB転送前に打ち切る
                event = {k: meta.get(k) for k in ('onid', 'tsid', 'sid', 'eid', 'eit_start_time')}
                # meta も同梱する。既存録画があって転送を打ち切る場合、受け側は
                # finalize へ進まないので、ここで渡さないと中身を埋められない
                # （前の転送が途中で落ちて行だけ残っていると、送り直しても空のまま）
                resp = self.session.post(
                    f'{self.base_url}/api/fed/recording/start',
                    json={'transfer_id': transfer_id, 'files': files, 'event': event,
                          'meta': meta},
                    timeout=(10, 60), verify=self.verify)
                resp.raise_for_status()
                already = resp.json().get('already')
                if already:  # 既存録画あり(転送不要)
                    _tell('already', size, size)
                    return already
                _tell('sending', 0, size)
                with open(ts_path, 'rb') as f:
                    resp = self.session.put(
                        f'{self.base_url}/api/fed/recording/{transfer_id}/file/'
                        f'{quote(name, safe="")}',
                        data=_ProgressReader(f, size, _tell),
                        headers={'Content-Length': str(size)},
                        timeout=(10, 7200), verify=self.verify)
                resp.raise_for_status()
                _tell('finalizing', size, size)
                resp = self.session.post(
                    f'{self.base_url}/api/fed/recording/{transfer_id}/finalize',
                    json={'meta': meta}, timeout=(10, 600), verify=self.verify)
                resp.raise_for_status()
                _tell('done', size, size)
                return resp.json()
            except Exception:
                _tell('error')
                try:
                    self.session.delete(f'{self.base_url}/api/fed/recording/{transfer_id}',
                                        timeout=(10, 30), verify=self.verify)
                except requests.RequestException:
                    pass
                raise
