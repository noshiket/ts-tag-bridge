"""確定情報の埋め・しょぼいの待ち・解析し直し・重複の自動スキップ"""

import json
from datetime import datetime
from text_parser.shoboi_api import rate_limit_remaining, has_rate_limited_error, background
from text_parser import shoboi_store
from logic.recordings import confirmed_fields
from .common import (  # noqa: F401
    _PARSER_RETRY_WITHIN,
    _RATE_LIMITED_DRAIN_PER_TICK,
    logger,
)
from .reparse_rule import _ReparseRuleMixin


class _ReparseMixin(_ReparseRuleMixin):
    """ReserveSyncWorker の一部（確定情報の埋め・しょぼいの待ち・解析し直し・重複の自動スキップ）。"""

    def _confirmed_of(self, rule_id: int) -> dict:
        """重複判定に使う確定値を rule から読む（一覧の重複表示と同じ値で判定する）。"""
        rule = self.db.get_rule(rule_id) or {}

        def _l(v):
            if isinstance(v, list):
                return v
            if v is None or v == '':
                return []
            try:
                p = json.loads(v)
                return p if isinstance(p, list) else [p]
            except (json.JSONDecodeError, TypeError):
                return [v]
        return {'folder': _l(rule.get('folder')), 'title': _l(rule.get('title')),
                'episode_number': _l(rule.get('episode_number')),
                'episode_name': _l(rule.get('episode_name')),
                'category': _l(rule.get('category'))}

    def _fill_missing_confirmed(self) -> tuple:
        """確定値の空欄を text_parser_result で補完する（1日1回）。

        再解析（日次リトライ・手動）で解析結果だけ新しくなった予約は、確定値列が
        空のままでは録画の見張りがその空の値を録画へ引き継ぎ、auto_encode の
        require_episode_name/_number ゲートも通らない。空欄（と '{$folder}' の
        ような未展開のプレースホルダ）だけを埋める。既存の値は手動修正の可能性が
        あるため上書きしない。
        録画は既にスキャン済みだと add_recording の判定が再度走らないため同様に補完する
        （エンコード済み(encode_finish)は確定値が出力に影響しないので対象外）。
        戻り値: (補完した予約の件数, 補完した録画の件数)
        """
        rules = recs = 0
        for rule in self.db.list_rules():
            if self._stop_event.is_set():
                break
            fields = confirmed_fields.missing_fields(
                rule, rule.get('text_parser_result') or {}, 'programs')
            if fields:
                self.db.update_rule(rule['id'], **fields)
                rules += 1
        for rec in self.db.list_recordings():
            if self._stop_event.is_set():
                break
            if rec.get('state') == 'encode_finish':
                continue
            fields = confirmed_fields.missing_fields(
                rec, rec.get('text_parser_result') or {}, 'recordings')
            if fields:
                self.db.update_recording(rec['id'], **fields)
                recs += 1
        return rules, recs

    @staticmethod
    def _starts_soon(rule: dict) -> bool:
        """放送が _PARSER_RETRY_WITHIN 以内か（過ぎたものも含む）。時刻が読めなければ True。"""
        try:
            st = datetime.fromisoformat(str(rule.get('start_time') or ''))
        except ValueError:
            return True
        now = datetime.now(st.tzinfo) if st.tzinfo else datetime.now()
        return st - now <= _PARSER_RETRY_WITHIN

    @background()
    def _drain_rate_limited(self) -> int:
        """規制で飛ばした予約を数件だけ解析し直す。解析した件数を返す。

        規制中も試す（手元の番組表・作品情報で済めば問い合わせない）。問い合わせが要って
        また後回しになったものは、次に番組表を取り直すまで試さない（同じものばかり試さない）。
        規制が明けている間は、問い合わせの枠を取り合うので番組表の取り直しと録画を先にする。
        """
        limited = rate_limit_remaining() > 0
        if not limited and (shoboi_store.sync_pending() or self._recordings_wait_parser()):
            return 0
        mark = shoboi_store.synced_at()
        done = 0
        for rule in self.db.list_rules():
            if done >= _RATE_LIMITED_DRAIN_PER_TICK:
                break
            if rule.get('state') == 'recorded' or not has_rate_limited_error(rule.get('parser_error')):
                continue
            if rate_limit_remaining() > 0 and self._limited_tried.get(rule['id']) == mark:
                continue
            parts = (rule.get('reserve_key') or '').split('-')
            if len(parts) != 4:
                continue
            try:
                onid, tsid, sid, _eid = (int(x) for x in parts)
                self._limited_tried[rule['id']] = mark
                self._reparse_rule(rule, sid, onid, tsid)
                done += 1
            except Exception as e:
                logger.warning('予約の同期: rule=%d 規制で飛ばした解析のやり直しに失敗: %s', rule['id'], e)
        if done:
            logger.info('予約の同期: 規制で飛ばした予約を %d件 解析し直しました', done)
        return done

    @background()
    def _reparse_after_sync(self) -> int:
        """番組表を取り直した後、番組情報が取れずにエラーが残っている予約のうち、番組表に
        番組が載ったものを解析し直す（規制で後回しにした分と、当時しょぼいカレンダーに
        番組が無くて getFromSid などが取れなかった分）。解析し直した件数を返す。"""
        n = 0
        try:
            for rule in self.db.list_rules():
                if self._stop_event.is_set():
                    break
                if rule.get('state') == 'recorded':
                    continue
                if not shoboi_store.waits_for_program_info(rule.get('parser_error')):
                    continue
                parts = (rule.get('reserve_key') or '').split('-')
                if len(parts) != 4:
                    continue
                try:
                    onid, tsid, sid, _eid = (int(x) for x in parts)
                except ValueError:
                    continue
                if not shoboi_store.has_program(sid, rule.get('start_time')):
                    continue
                try:
                    self._reparse_rule(rule, sid, onid, tsid)
                    n += 1
                except Exception as e:
                    logger.warning('予約の同期: rule=%d 番組表の取り直し後の解析に失敗: %s', rule['id'], e)
            logger.info('予約の同期: 番組表の取り直し後、番組が載った予約を %d件 解析し直しました', n)
            # 取り直した番組表・作品情報で、範囲内の予約・録画のしょぼいカレンダー情報を書き直す
            m = self._fill_shoboi_info(only_missing=False)
            logger.info('予約の同期: 番組表の取り直し後、しょぼいカレンダー情報を %d件 書き直しました', m)
        finally:
            self._post_sync_running = False
        return n

    def _fill_shoboi_info(self, only_missing: bool) -> int:
        """予約・録画にしょぼいカレンダー情報(shoboi_info)を書く。変わった行だけ書き、書いた件数を返す。

        手元の番組表の範囲内の放送だけを見る（範囲外は分からないので NULL のまま）。
        only_missing はまだ書いていない行だけ（定期処理で新しい予約・録画を埋める）。
        """
        win = shoboi_store.window()
        if not win:
            return 0
        n = 0
        for kind in ('programs', 'recordings'):
            for row in self.db.list_shoboi_targets(kind, only_missing):
                if self._stop_event.is_set():
                    return n
                sid = row.get('sid')
                parts = (row.get('reserve_key') or '').split('-')
                if not sid and len(parts) == 4 and parts[2].isdigit():
                    sid = int(parts[2])
                try:
                    st = datetime.fromisoformat(str(row.get('start_time') or '')).replace(tzinfo=None)
                except ValueError:
                    continue
                if not sid or not (win[0] <= st <= win[1]):
                    continue
                info = shoboi_store.info_for(sid, row['start_time'])
                if info is None:
                    continue
                new = json.dumps(info, ensure_ascii=False, sort_keys=True)
                if new != row.get('shoboi_info'):
                    self.db.set_shoboi_info(kind, row['id'], new)
                    n += 1
        return n

    def _recordings_wait_parser(self) -> bool:
        """規制で解析を飛ばした録画が残っているか。

        しょぼいカレンダーの上限は予約と録画で取り合うので、残っている間は録画を先にする
        （録画は解析が済まないとエンコードに進めない）。"""
        return any(has_rate_limited_error(r.get('parser_error') or '')
                   for r in self.db.list_recordings_by_state('waiting'))


