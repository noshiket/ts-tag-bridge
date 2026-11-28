"""新しい予約をルールとして登録する（解析・確定値）"""

import json
from datetime import datetime, timedelta
from read_tsprogram.program_info import normalize_text
from text_parser.parser.common import parser_errors
from text_parser.shoboi_api import rate_limited_error
from text_parser import shoboi_api
from logic.recordings.epg_auto_add import find_auto_add_id
from .common import logger
from .epg_meta import _epg_meta, _ids, _to_text


def _confirmed_from_result(result) -> dict:
    """text_parser の結果から確定値の列を作る。

    is_text_parser: 1=マッチ, 0=手動, -1=解析試行済み(マッチなし), None=未解析
    """
    if not result:
        return {'is_text_parser': -1}
    return dict(
        title              = _to_text(result.get('title')),
        folder             = _to_text(result.get('folder')),
        episode_name       = _to_text(result.get('episode_name')),
        episode_number     = _to_text(result.get('episode_number')),
        category           = _to_text(result.get('category')),
        furigana           = _to_text(result.get('furigana')),
        else_info          = _to_text(result.get('else')),
        auto_send          = (1 if result['auto_send'] else 0) if 'auto_send' in result else None,
        app_output_path    = _to_text(result.get('app_output_path')),
        app_output_path_format = _to_text(result.get('app_output_path_format')),
        setting            = _to_text(result.get('setting')),
        is_text_parser     = 1,
    )


class _RegisterMixin:
    """新しい予約をルールとして登録する（解析・確定値）"""

    def _register_reserve(self, rsv, existing, auto_add_rules):
        """予約を text_parser で解析して programs に登録する（existing があれば解析し直して上書き）。"""
        reserve_id = rsv.get('reserveID')
        onid, tsid, sid, eid = _ids(rsv)
        reserve_key  = f'{onid}-{tsid}-{sid}-{eid}'
        title        = normalize_text(rsv.get('title', ''))
        station_name = rsv.get('stationName', '')
        start_time   = rsv.get('startTime', '')
        duration_sec = rsv.get('durationSecond', 0)

        # expected_end_time
        try:
            start_dt = datetime.fromisoformat(start_time)
            expected_end_time = (start_dt + timedelta(seconds=duration_sec)).isoformat()
        except (ValueError, TypeError):
            expected_end_time = ''

        # 番組表から title / description / extended_info を取得
        description   = ''
        extended_info = ''
        genre = ''
        video_info = ''
        audio_info = ''
        try:
            events = self.edcb.enum_event_info(
                f'{onid}-{tsid}-{sid}-{eid}', basic=0)
            if events:
                meta = _epg_meta(events[0])
                description   = meta['description']
                extended_info = meta['extended_info']
                if meta['event_name']:
                    title = normalize_text(meta['event_name'])  # EPG タイトルを優先
                genre, video_info, audio_info = meta['genre'], meta['video_info'], meta['audio_info']
        except Exception:
            pass  # EPG 取得失敗は無視してタイトルのみで解析

        # 録画マージン・BAT タグ取得
        rec_setting  = rsv.get('recSetting') or {}
        start_margin = rec_setting.get('startMargin')
        end_margin   = rec_setting.get('endMargin')
        _bat_path    = rec_setting.get('batFilePath', '')
        edcb_tag     = _bat_path.split('*', 1)[1] if '*' in _bat_path else rec_setting.get('batFileTag', '')

        # text_parser 解析（SID ごとのパターンファイルを使用）
        context = {
            **self.config.get('text_parser_context', {}),
            'sid': sid, 'onid': onid, 'tsid': tsid,
            'service_name': station_name, 'start_time': start_time,
            'title': title, 'description': description, 'extended_info': extended_info,
        }
        parser = self.parser_store.get_parser(sid)
        # 規制中でも解析する。規制で取れなかった項目があれば結果は使わず、
        # 規制明けに _drain_rate_limited が解析し直す
        before = shoboi_api.limited_count()
        result = parser.parse_text(title, context=context) if parser else None

        if not result:
            result = {}

        # parser_error を独立カラムにも保存（text_parser_result にも残す）
        # パターンがあるのにマッチしなかった場合も1件入れる（パターン未設定の局は
        # 全件エラーになってしまうので入れない）
        parser_error = parser_errors(result) if parser else []
        if parser and shoboi_api.hit_limit_during(before, parser_error):
            # 解析の途中で規制された → 結果は使わず、規制で飛ばした印だけ付ける
            result = {}
            parser_error = [rate_limited_error()]
        parser_error_json = json.dumps(parser_error, ensure_ascii=False)

        confirmed = _confirmed_from_result(result)

        # EPG自動予約ルールと照合して auto_add_id を決定
        comment = rsv.get('comment', '')
        program_data = dict(
            reserve_key=reserve_key,
            original_title=title,
            original_description=description,
        )
        auto_add_id = find_auto_add_id(program_data, comment, auto_add_rules)

        if existing:
            updates = dict(
                text_parser_result=result,
                parser_error=parser_error_json,
                original_title=title,
                original_description=description,
                original_extended_info=extended_info,
                edcb_tag=edcb_tag,
                **confirmed,
            )
            # auto_add_id が未設定のときだけ更新（手動設定を上書きしない）
            if existing.get('auto_add_id') is None and auto_add_id is not None:
                updates['auto_add_id'] = auto_add_id
            self.db.update_rule(existing['id'], **updates)
            logger.info('予約の同期: reserve %d "%s" → re-parsed', reserve_id, title)
            return

        self.db.add_rule(
            reserve_id=reserve_id,
            reserve_key=reserve_key,
            original_title=title,
            station_name=station_name,
            start_time=start_time,
            expected_end_time=expected_end_time,
            text_parser_result=result,
            parser_error=parser_error_json,
            state='pending',
            original_description=description,
            original_extended_info=extended_info,
            start_margin=start_margin,
            end_margin=end_margin,
            genre=genre,
            video_info=video_info,
            audio_info=audio_info,
            edcb_tag=edcb_tag,
            server_url=self.edcb_url,
            auto_add_id=auto_add_id,
            **confirmed,
        )
        logger.info('予約の同期: reserve %d "%s" → pending (auto_add_id=%s)', reserve_id, title, auto_add_id)

        # 重複自動スキップ(設定 auto_skip_duplicates): 解析値が既存videoと
        # 全話一致(SID含む)し、一致した全videoが重複許可OFF(drop/scrambleなし)
        # なら予約を録画無効にする。新規予約の初回解析時のみ判定する
        # (手動で有効へ戻した予約を再解析で再スキップしない)
        if (self.config.get('auto_skip_duplicates') and result
                and rec_setting.get('recEnabled', True)):
            self._try_auto_skip_duplicate(rsv, result)
