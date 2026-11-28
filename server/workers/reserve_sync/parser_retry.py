"""解析に失敗した予約の解析し直し"""

import json
import logging
import os
import time
from read_tsprogram.program_info import normalize_text, normalize_extended_info
from text_parser.shoboi_api import (
    rate_limit_remaining,
    has_rate_limited_error,
    background,
)
from text_parser import shoboi_store
from .common import (  # noqa: F401
    logger,
)


class _ParserRetryMixin:
    """ReserveSyncWorker の一部（解析に失敗した予約の解析し直し）。"""

    def _load_last_parser_retry(self) -> float:
        """前回の日次再解析の時刻を、time.monotonic() の基準に直して返す。無ければ 0。"""
        try:
            with open(self._parser_retry_state, encoding='utf-8') as f:
                at = float(json.load(f).get('at') or 0)
        except (OSError, ValueError, TypeError, AttributeError):
            return 0.0
        return time.monotonic() - max(0.0, time.time() - at) if at else 0.0

    def _save_last_parser_retry(self) -> None:
        try:
            tmp = self._parser_retry_state + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'at': time.time()}, f)
            os.replace(tmp, self._parser_retry_state)
        except OSError as e:
            logger.warning('予約の同期: 日次再解析の時刻を保存できません: %s', e)

    @background()
    def _retry_parser_error_rules(self) -> tuple:
        """予約の EPG を取り直し、内容が変わっていたら text_parser を再実行する。

        予約直後は EPG の番組名/概要が暫定（「番組情報なし」等）で、解析に失敗したり
        別のパターンに当たったりする。放送が近づくと確定するので、日次で拾い直す。
        （例: 初回は「炎の球技女　ボール子」で登録され、タイトル更新後のパターンで
        解析すると「炎の球技児」が正しい。再解析しないと誤った確定値のまま録画される）

        対象は EPG が変わった予約と parser_error が残っている予約
        （後者はパターン側が直っていることがあるので、EPG が同じでも解析し直す）。
        放送済み(state='recorded')は録画側の解析に委ねるため対象外。
        戻り値: (EPGを更新した件数, エラーが解消した件数)
        """
        updated = fixed = 0
        # 重複自動スキップの判定に使う（recEnabled を見て、手動で無効にした予約は触らない）
        try:
            reserves = {r.get('reserveID'): r for r in (self.edcb.enum_reserve_info() or [])}
        except Exception:
            reserves = {}
        self._retry_yielded = False
        for rule in self.db.list_rules():
            if self._stop_event.is_set():
                break
            # 規制中も続ける（手元の番組表・作品情報で済む解析はそのまま使い、問い合わせが
            # 要るものだけ後回しの印が付く）。枠を取り合うのは規制が明けている時だけ
            if rate_limit_remaining() <= 0 and (
                    self._recordings_wait_parser() or shoboi_store.sync_pending()):
                logger.info('予約の同期 parser retry: 番組表の取り直しか、規制で解析を飛ばした録画を先にします')
                self._retry_yielded = True
                break
            if rule.get('state') == 'recorded':
                continue
            parts = (rule.get('reserve_key') or '').split('-')
            if len(parts) != 4:
                continue
            rule_id = rule['id']
            try:
                onid, tsid, sid, eid = (int(x) for x in parts)
            except ValueError:
                continue

            # 1. EPG から番組名・概要・詳細を取り直す
            try:
                events = self.edcb.enum_event_info(f'{onid}-{tsid}-{sid}-{eid}', basic=0)
            except Exception as e:
                # 放送が終わって番組表から消えた予約では毎回こうなる（いつものこと）。それ以外は知らせる
                lv = logging.DEBUG if 'EPGデータを読み込み中' in str(e) else logging.WARNING
                logger.log(lv, '予約の同期 parser retry: rule=%d EPG取得失敗: %s', rule_id, e)
                continue
            if not events:
                continue
            ev = events[0]
            short = ev.get('shortInfo') or {}
            title = normalize_text(short.get('event_name', '') or '')
            # 取り込み(_tick)と同じ正規化をする。揃っていないと、ここで正規化前の値に
            # 書き戻す → 毎分の取り込みが「変わった」と見て解析し直す、を毎日繰り返す
            description = normalize_text(short.get('text_char', '') or '')
            extended = normalize_extended_info((ev.get('extInfo') or {}).get('text_char', '') or '')
            # 取得できない項目で既存を空に上書きしない
            changed = {}
            if title and title != (rule.get('original_title') or ''):
                changed['original_title'] = title
            if description != (rule.get('original_description') or ''):
                changed['original_description'] = description
            if extended != (rule.get('original_extended_info') or ''):
                changed['original_extended_info'] = extended
            if changed:
                self.db.update_rule(rule_id, **changed)
                updated += 1
                rule = self.db.get_rule(rule_id) or rule

            # 2. 番組情報が変わった/解析が通っていない予約は解析し直す
            #    （結果と確定値はリンク録画にも同期する）
            #    解析結果が空(=どのパターンにもマッチしていない)も対象にする。
            #    parser_error だけを条件にすると、何かの理由でエラーが記録されないまま
            #    未解析になった予約が二度と拾われない（エラーが無いので再解析されず、
            #    再解析されないのでエラーも付かない）。実データで現行予約20件中15件が
            #    この状態で滞留していた。
            if (changed or not (rule.get('text_parser_result') or {})
                    or has_rate_limited_error(rule.get('parser_error'))
                    or (rule.get('parser_error') and self._starts_soon(rule))):
                try:
                    ok, _result, _cv = self._reparse_rule(rule, sid, onid, tsid)
                    if ok:
                        fixed += 1
                    rule = self.db.get_rule(rule_id) or rule
                except Exception as e:
                    logger.warning('予約の同期 parser retry: rule=%d 再解析失敗: %s', rule_id, e)

            # 3. 更新後の確定値で重複判定する。初回登録時は暫定EPGで解析できておらず
            #    重複判定もできていない／後から登録したvideoで重複になることもあるので、
            #    番組情報が変わらなくても毎日見る。
            #    対象は録画有効かつ「まだ自動スキップしていない」予約だけ
            #    （一度スキップしたものを手動で戻した場合、その判断を尊重して再処理しない）
            rsv = reserves.get(rule.get('reserve_id'))
            if (self.config.get('auto_skip_duplicates') and rsv
                    and not rule.get('auto_skip_reason')
                    and (rsv.get('recSetting') or {}).get('recEnabled', True)):
                try:
                    self._try_auto_skip_duplicate(rsv, self._confirmed_of(rule_id))
                except Exception as e:
                    logger.warning('予約の同期 parser retry: rule=%d 重複判定失敗: %s', rule_id, e)
        return updated, fixed
