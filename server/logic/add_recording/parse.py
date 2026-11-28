"""text_parser の呼び出し（時間切れ・規制で後回しにした分の解析し直し）と video.db"""

import data_paths  # server/ と server/data の場所
import json
import logging
import os
from logic.recordings import confirmed_fields, confirmed_values
from .parser_timeout import _parse_with_timeout


logger = logging.getLogger('logic.add_recording')   # 分ける前と同じ名前で出す

_video_db = None


def _get_video_db():
    """video.db への接続（VideoDB）をモジュール内で再利用する。worker スレッドから
    呼ばれるため app.config は使わず、data/video.db を直接開く（encode_pipeline と同方式）。"""
    global _video_db
    if _video_db is None:
        from db.video_db.core import VideoDB
        _video_db = VideoDB(os.path.join(data_paths.DATA_DIR, 'video.db'))
    return _video_db

# CONFIRMED VALUES のカラム一覧・空判定・書き込み内容は logic/recordings/confirmed_values を参照


def _apply_text_parser(db, rec_id: int, ts_result, sid, config: dict, parser_store):
    """text_parser を実行し(ARX)、確定値を更新する(AR3)。更新後の recording を返す（消えていれば None）。

    録画側(TS の番組名)が正。ただし解析し直すのは、予約の解析が無い・エラーの時と、
    TS の番組名が予約(EDCB)の番組名と違う時だけ。同じ番組名なら予約の解析と同じ結果になるので、
    しょぼいカレンダーへの問い合わせを増やさない（429 で長時間規制されたことがある。
    それまでに録れた 64件は全件で番組名が一致していた）。

    しょぼいカレンダーの規制中は解析せず、parser_error に規制の印（いつまで規制か付き）を付けて先へ進む。
    規制が明けたら retry_rate_limited() で解析し直す。
    """
    from text_parser import shoboi_api
    from text_parser.shoboi_api import rate_limit_remaining, rate_limited_error, is_rate_limited_error
    logger.debug('add_recording: recording_id=%d text_parser', rec_id)
    recording = db.get_recording(rec_id)
    if recording is None:
        return None
    tp_raw     = recording.get('text_parser_result')
    parser_err = recording.get('parser_error') or []
    # parser_error 列に加えて text_parser_result 内の parser_error も見る
    # (列が空でJSON内にだけエラーが残っている行が再解析されず放置されていた)
    tp_err_inside = []
    if tp_raw:
        try:
            _tp = json.loads(tp_raw) if isinstance(tp_raw, str) else tp_raw
            tp_err_inside = (_tp or {}).get('parser_error') or []
        except Exception:
            pass
    # 規制で飛ばした印は「予約の解析が悪い」ではないので、確定値の上書きの判断には使わない
    real_err = [e for e in parser_err if not is_rate_limited_error(e)]
    needs_parse = (not tp_raw) or bool(parser_err) or bool(tp_err_inside)
    old_tp = {}
    if tp_raw:
        try:
            old_tp = (json.loads(tp_raw) if isinstance(tp_raw, str) else tp_raw) or {}
        except Exception:
            old_tp = {}
    ts_title = (ts_result or {}).get('title', '') or ''
    edcb_title = recording.get('edcb_title') or ''
    title_changed = bool(ts_title) and edcb_title != ts_title

    def _mark_rate_limited():
        # 前の印は外して、今の規制の期限で付け直す
        errs = list(dict.fromkeys(real_err + [rate_limited_error()]))
        db.update_recording(rec_id, parser_error=errs)
        logger.info('add_recording: recording_id=%d しょぼいカレンダーの規制中(残り%.0f秒)なので'
                    'text_parser は後回し', rec_id, rate_limit_remaining())

    if parser_store and ts_result and (needs_parse or title_changed):
        parser = parser_store.get_parser(sid)
        if parser:
            tp_context = {
                **config.get('text_parser_context', {}),
                'sid':           sid,
                'onid':          ts_result.get('nid'),
                'tsid':          ts_result.get('tsid'),
                'service_name':  ts_result.get('service_name', ''),
                'start_time':    ts_result.get('start_time', ''),
                'title':         ts_result.get('title', ''),
                'description':   ts_result.get('description', ''),
                'extended_info': ts_result.get('extended_info', ''),
            }
            try:
                from text_parser.parser.common import parser_errors
                # 規制中でも解析する（しょぼいカレンダーを使わない解析はそのまま使う）
                before = shoboi_api.limited_count()
                tp_new = _parse_with_timeout(parser, ts_result.get('title', ''), tp_context)
                if shoboi_api.hit_limit_during(before, parser_errors(tp_new)):
                    # 解析の途中で規制された。取れなかった項目は規制のせいなので結果は使わない
                    _mark_rate_limited()
                elif tp_new and not needs_parse and parser_errors(tp_new):
                    logger.info('add_recording: recording_id=%d TS の番組名での解析がエラーなので'
                                '予約の解析を残します: %s', rec_id, parser_errors(tp_new))
                elif tp_new:
                    db.update_recording(rec_id,
                        text_parser_result=json.dumps(tp_new, ensure_ascii=False),
                        parser_error=parser_errors(tp_new),
                        is_text_parser=1,
                    )
                    logger.debug('add_recording: recording_id=%d text_parser OK', rec_id)
                elif needs_parse:
                    # マッチしなかったことも残す（解析結果は書き換えない）
                    db.update_recording(rec_id, parser_error=parser_errors(None))
                    logger.info('add_recording: recording_id=%d text_parser マッチなし', rec_id)
                else:
                    logger.info('add_recording: recording_id=%d TS の番組名ではどのパターンにも'
                                '当たらないので予約の解析を残します', rec_id)
            except TimeoutError as e:
                # 解析が固まっても、後ろの録画を待たせない。予約の解析が使えている時はそのまま、
                # 無い時は「解析できなかった」と残す（録画詳細の再解析で取り直せる）
                logger.warning('add_recording: recording_id=%d %s。解析は飛ばして先へ進みます', rec_id, e)
                if needs_parse:
                    db.update_recording(rec_id, parser_error=['text_parser:timeout'])
            except Exception as e:
                logger.warning('add_recording: recording_id=%d text_parser failed: %s', rec_id, e)

    # ── AR3: CONFIRMED VALUES 更新判定 ─────────────────────────────────────
    # 判定・書き込み内容は logic/recordings/confirmed_values に集約（予約側の再解析と共通規約）:
    #   parser_error が解消 or 確定値が全て空 → 解析結果で上書き
    #   それ以外                             → 空欄(と未展開プレースホルダ)のみ補完
    recording = db.get_recording(rec_id)
    if recording is None:
        return None
    tp = recording.get('text_parser_result') or {}
    if isinstance(tp, str):
        try:
            tp = json.loads(tp)
        except Exception:
            tp = {}
    if tp:
        # had_error は再解析の前、has_error は再解析後の状態
        had_error = bool(real_err) or bool(tp_err_inside)
        has_error = bool(recording.get('parser_error'))
        if confirmed_values.should_overwrite(recording, had_error, has_error):
            _write_confirmed(db, rec_id, tp)
            recording = db.get_recording(rec_id)
        elif not had_error and old_tp and tp != old_tp:
            # 予約の解析から変わった → 予約の解析のままの確定値だけ追従させる（手で直した値は残す）
            fields = confirmed_values.changed_fields(recording, old_tp, tp, 'recordings')
            if fields:
                db.update_recording(rec_id, **fields)
                recording = db.get_recording(rec_id)
                logger.info('add_recording: recording_id=%d TS の番組名での解析に確定値を追従: %s',
                            rec_id, ', '.join(sorted(fields)))
        else:
            fill = confirmed_fields.missing_fields(recording, tp, 'recordings')
            if fill:
                db.update_recording(rec_id, **fill)
                recording = db.get_recording(rec_id)
                logger.info('add_recording: recording_id=%d 確定値の空欄を補完: %s',
                            rec_id, ', '.join(fill))
    return recording


def _write_confirmed(db, rec_id: int, tp: dict) -> None:
    """text_parser_result から CONFIRMED VALUES を recordings に書き込む（上書き）。"""
    fields = confirmed_fields.all_fields(tp, 'recordings')
    if fields:
        db.update_recording(rec_id, is_text_parser=1, **fields)
