"""ReserveSyncWorker の本体。メソッドは機能ごとに mixin へ分けてある。"""

import os
import threading
import time
from text_parser.shoboi_api import rate_limit_remaining, background
from text_parser import shoboi_store
from workers.base import IntervalWorker
from .common import (  # noqa: F401
    logger,
)
from .parser_retry import _ParserRetryMixin
from .reparse import _ReparseMixin
from .epg_meta import _EpgMetaMixin
from .register import _RegisterMixin


class ReserveSyncWorker(_EpgMetaMixin, _RegisterMixin, _ParserRetryMixin, _ReparseMixin, IntervalWorker):
    """
    interval 秒ごとに EDCB の予約一覧を取得し、未登録の予約を DB に追加する。

    - 未登録の予約 → state='pending', text_parser_result に解析結果を保存
    - 登録済み     → スキップ
    """

    label = 'reserve_sync'
    log_name = 'workers.reserve_sync'   # クラスを core.py へ移す前と同じ名前で出す

    def __init__(self, config: dict, db, edcb, parser_store):
        super().__init__(config.get('phase_a_interval', 120))
        self.config = config
        self.db = db
        self.edcb = edcb
        self.parser_store = parser_store
        self.edcb_url = ((config.get('edcb_servers') or [{}])[0].get('url')) or config.get('edcb_url', '')
        # 古いprograms/recordingsの定期クリーンアップ(logic/cleanup/db_cleanup)の最終実行時刻。
        # tickは~120秒毎だが削除処理は1時間に1回で十分なためゲートする。
        self._last_cleanup = 0.0
        # parser_error が残っている予約の EPG 再取得＋再解析の最終実行時刻（1日1回）。
        # 予約直後は EPG の番組名/概要が暫定（「番組情報なし」等）で解析に失敗することがあり、
        # 放送が近づくと確定するため、日次で取り直して解析し直す。
        # 実行時刻はファイルにも残す。メモリだけだと再起動のたびに全件を解析し直し、しょぼい
        # カレンダーへ同じ問い合わせを繰り返して規制された（2回の再起動の
        # 直後にそれぞれ数十回、規制の直接のきっかけになった）
        self._parser_retry_state = os.path.join(
            os.path.dirname(os.path.abspath(getattr(db, 'db_path', '') or 'x')), 'phase_a_parser_retry.json')   # 置き場の名前は昔の呼び名のまま（両方のマシンの data にある）
        self._last_parser_retry = self._load_last_parser_retry()
        self._parser_retry_running = False   # 再解析スレッドの多重起動防止
        self._retry_yielded = False          # 日次再解析を録画のために途中で譲ったか
        self._limited_tried = {}             # 規制中に解析し直しを試した予約 → その時の番組表の取得時刻
        self._post_sync_mark = 0.0           # 番組表の取り直し後の解析し直しを済ませた取得時刻
        self._post_sync_running = False

    def _tick(self):
        reserves = self.edcb.enum_reserve_info()
        try:
            auto_add_rules = self.edcb.enum_auto_add() or []
        except Exception:
            auto_add_rules = []
        for rsv in reserves:
            reserve_id = rsv.get('reserveID')
            if reserve_id is None:
                continue
            existing = self.db.get_by_reserve_id(reserve_id)
            if existing and not (existing['state'] == 'pending' and existing.get('is_text_parser') is None):
                # 登録済み → EPG メタ情報（説明・ジャンル・映像・音声）のみ更新
                try:
                    self._refresh_epg_meta(rsv, existing)
                except Exception as e:
                    # 番組表に無い予約（プログラム予約・番組表の取り込み前など）は EDCB が
                    # 「EPGデータを読み込み中、または存在しません」を返す。毎回起きる普通のことなので残さない
                    log = logger.debug if 'EPGデータを読み込み中' in str(e) else logger.warning
                    log('予約の同期: rule=%d EPG メタ情報の取り直しに失敗: %s', existing['id'], e)
                continue
            # 新しい予約か、登録だけして未解析のもの → 解析して登録
            self._register_reserve(rsv, existing, auto_add_rules)

        # ── しょぼいカレンダーの番組表・作品情報を取り直す（6時間ごと。数回の問い合わせで
        #    解析に使う分をまとめて手元に置く）。数十秒かかるので別スレッドで ──────────
        threading.Thread(target=shoboi_store.sync_if_due, daemon=True).start()

        # ── 規制で飛ばした予約を、規制が明けていれば数件ずつ解析し直す ──────────
        try:
            self._drain_rate_limited()
        except Exception as e:
            logger.error('予約の同期 rate-limited drain failed: %s', e)

        # ── 番組表を取り直したら、番組情報が取れずに残っていた予約を解析し直す ──────────
        mark = shoboi_store.synced_at()
        if mark and mark != self._post_sync_mark and not self._post_sync_running:
            self._post_sync_mark = mark
            self._post_sync_running = True
            threading.Thread(target=self._reparse_after_sync, daemon=True).start()

        # ── 新しい予約・録画にしょぼいカレンダー情報を書く（手元の番組表だけで引く）─────
        try:
            self._fill_shoboi_info(only_missing=True)
        except Exception as e:
            logger.error('予約の同期 shoboi info fill failed: %s', e)

        self._start_parser_retry_if_due()
        self._cleanup_if_due(reserves)


    def _start_parser_retry_if_due(self):
        """parser_error の残る予約を EPG 再取得 → 再解析（1日1回）。

        対象が数百件あり、parse_text は しょぼいカレンダー等への同期HTTP(最大10秒)を含むため
        tick(120秒間隔)を塞がないよう別スレッドで走らせる。多重起動はフラグで防ぐ。
        """
        if not (time.monotonic() - self._last_parser_retry >= 86400
                and not self._parser_retry_running):
            return
        self._last_parser_retry = time.monotonic()
        self._parser_retry_running = True

        def _run_retry():
            try:
                n_upd, n_fixed = self._retry_parser_error_rules()
                logger.info('予約の同期 parser retry: EPG更新 %d件 / エラー解消 %d件', n_upd, n_fixed)
                with background():
                    limited = rate_limit_remaining() > 0
                if self._retry_yielded:
                    # 番組表の取り直し・録画に譲って途中でやめた。1時間後にまたやる
                    self._last_parser_retry = time.monotonic() - 86400 + 3600
                elif limited:
                    # 規制中で後回しになった分がある。番組表を取り直す頃(6時間後)にまたやる
                    self._last_parser_retry = time.monotonic() - 86400 + 6 * 3600
                else:
                    self._save_last_parser_retry()
            except Exception as e:
                logger.error('予約の同期 parser retry failed: %s', e)
            # 再解析の後に流す（この回で解消した分もまとめて確定値へ反映される）
            try:
                n_rules, n_recs = self._fill_missing_confirmed()
                logger.info('予約の同期 confirmed fill: 確定値の空欄を補完 予約%d件 / 録画%d件',
                            n_rules, n_recs)
            except Exception as e:
                logger.error('予約の同期 confirmed fill failed: %s', e)
            finally:
                self._parser_retry_running = False

        threading.Thread(target=_run_retry, daemon=True, name='reserve_sync_parser_retry').start()

    def _cleanup_if_due(self, reserves):
        """定期クリーンアップ（1時間毎）。

        スキップのまま期間終了したprograms・保持日数超過のprograms/ファイル消失recordings
        を削除する。reservesは _tick で取得済みのものをそのまま渡す(スキップ判定に使用)。
        enum_reserve_infoが失敗した場合はここに到達しないため、空データで誤削除しない。
        """
        if time.monotonic() - self._last_cleanup < 3600:
            return
        self._last_cleanup = time.monotonic()
        try:
            from logic.cleanup.db_cleanup import cleanup_stale
            counts = cleanup_stale(self.db, self.config, reserves)
            if counts and any(counts.values()):
                logger.info('予約の同期 cleanup: %s', counts)
        except Exception as e:
            logger.error('予約の同期 cleanup failed: %s', e)


