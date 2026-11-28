"""予約の同期: ルール1件を解析し直す（規制中の印・重複の自動スキップ）"""

import json
from text_parser.parser.common import parser_errors
from text_parser.shoboi_api import rate_limit_remaining, rate_limited_error, is_rate_limited_error
from text_parser import shoboi_api
from logic.recordings import confirmed_fields, confirmed_values
from .common import logger


class _ReparseRuleMixin:
    """予約の同期: ルール1件を解析し直す（規制中の印・重複の自動スキップ）"""

    def _mark_rate_limited(self, rule: dict) -> None:
        """規制中で解析しなかった印を付ける（解析結果と確定値は今のまま）。"""
        # 前の印は外して、今の規制の期限で付け直す
        errs = [e for e in (rule.get('parser_error') or []) if not is_rate_limited_error(e)]
        errs = list(dict.fromkeys(errs + [rate_limited_error()]))
        self.db.update_rule(rule['id'], parser_error=json.dumps(errs, ensure_ascii=False))
        logger.info('予約の同期: rule=%d しょぼいカレンダーの規制中(残り%.0f秒)なので解析は後回し',
                    rule['id'], rate_limit_remaining())

    def _reparse_rule(self, rule: dict, sid: int, onid: int, tsid: int) -> tuple:
        """rule を text_parser で解析し直して保存する。

        戻り値 (parser_error が解消したか, 解析結果, 確定値が変わったか)。
        parser がいない場合は (False, {}, False)。"""
        rule_id = rule['id']
        context = {
            **self.config.get('text_parser_context', {}),
            'sid': sid, 'onid': onid, 'tsid': tsid,
            'service_name':  rule.get('station_name', ''),
            'start_time':    rule.get('start_time', ''),
            'title':         rule.get('original_title', ''),
            'description':   rule.get('original_description', ''),
            'extended_info': rule.get('original_extended_info', ''),
        }
        parser = self.parser_store.get_parser(sid)
        if parser is None:
            return False, {}, False
        # 規制中でも解析はする（しょぼいカレンダーを使わない解析や、手元の番組表で答えられる
        # 解析はそのまま使う）。規制で取れなかった項目があった時だけ後回しにする
        before = shoboi_api.limited_count()
        result = parser.parse_text(rule.get('original_title', ''), context) or {}
        pe = parser_errors(result)   # マッチしなかった場合も1件入る
        if shoboi_api.hit_limit_during(before, pe):
            # 取れなかった項目は規制のせいなので結果は使わない
            self._mark_rate_limited(rule)
            return False, {}, False
        pe_json = json.dumps(pe, ensure_ascii=False)
        result_json = json.dumps(result, ensure_ascii=False)
        # recorded は state を変えない（録画の見張り再トリガー防止。ここでは対象外だが同じ扱いにする）
        new_state = rule.get('state', 'pending')
        if new_state != 'recorded':
            new_state = 'pending'
        # 確定値の更新規約は logic/recordings/confirmed_values に集約（録画側 AR3 と共通）
        old = rule.get('text_parser_result') or {}
        if isinstance(old, str):
            try:
                old = json.loads(old)
            except (json.JSONDecodeError, TypeError):
                old = {}
        had_error = bool(rule.get('parser_error'))
        overwrite = confirmed_values.should_overwrite(rule, had_error, bool(pe))
        if overwrite:
            cv_fields = confirmed_fields.all_fields(result, 'programs')
        elif not had_error and result != old:
            # 番組情報の更新で解析結果が変わった → 古い解析結果のままの確定値を追従させる。
            # 比較の基準にできるのは parser_error の無い元の解析値だけ（エラー中の値は
            # 未確定なので差分の意味がない）。新しい解析結果は parser_error があっても
            # 取れた項目は反映する（取れなかった項目は空なので書かない）
            cv_fields = confirmed_values.changed_fields(rule, old, result, 'programs')
        else:
            cv_fields = confirmed_fields.missing_fields(rule, result, 'programs')
        self.db.update_rule(rule_id, text_parser_result=result,
                            parser_error=pe_json, state=new_state, **cv_fields)
        # リンク録画の解析結果も同期（recordings/augmented は録画側を優先表示するため）
        for rec in self.db.get_recordings(rule_id):
            rec_had_error = bool(rec.get('parser_error'))
            rec_ow = confirmed_values.should_overwrite(rec, rec_had_error, bool(pe))
            if rec_ow:
                rec_fields = confirmed_fields.all_fields(result, 'recordings')
            elif not rec_had_error and result != old:
                rec_fields = confirmed_values.changed_fields(rec, old, result, 'recordings')
            else:
                rec_fields = confirmed_fields.missing_fields(rec, result, 'recordings')
            self.db.update_recording(rec['id'], text_parser_result=result_json,
                                     parser_error=pe_json, **rec_fields)
        if cv_fields:
            logger.info('予約の同期: rule=%d 番組情報の更新で確定値を追従 %s',
                        rule_id, ', '.join(sorted(cv_fields)))
        return not pe, result, bool(cv_fields)

    def _try_auto_skip_duplicate(self, rsv: dict, values: dict) -> None:
        """予約の重複自動スキップ: 確定値が既存videoと全話一致すれば録画無効にする。

        判定は logic.recordings.segment_calculator.check_duplicate_skip(SID一致必須・
        一致した全videoの重複許可OFF・予約categoryが一致videoのcategoryと交差が条件)。
        categoryが違う/告知(announce)ありのvideoはスキップしない。失敗しても予約処理は継続する。
        """
        try:
            from logic.recordings.duplicates import check_duplicate_skip
            from logic.encode_pipeline.base.context import _get_video_db

            def _l(v):
                return v if isinstance(v, list) else ([] if v is None else [v])
            if check_duplicate_skip(_get_video_db(),
                                    values.get('folder'), values.get('title'),
                                    _l(values.get('episode_number')),
                                    _l(values.get('episode_name')),
                                    rsv.get('sid'),
                                    values.get('category')):
                self.edcb.change_reserve(rsv['reserveID'], recEnabled=0)
                # EDCB側/手動のスキップと区別できるよう理由を残す（一覧の絞り込み用）
                rule = self.db.get_by_reserve_id(rsv['reserveID'])
                if rule:
                    self.db.update_rule(rule['id'], auto_skip_reason='duplicate')
                logger.info('予約の同期: reserve %d "%s" 既存videoと全話重複のため自動スキップ',
                            rsv['reserveID'], rsv.get('title'))
        except Exception as e:
            logger.warning('予約の同期: 重複自動スキップ判定失敗 reserve=%s: %s',
                           rsv.get('reserveID'), e)
