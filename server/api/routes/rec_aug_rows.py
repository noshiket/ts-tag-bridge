"""録画結果の1行の形（状態・確定値・ドロップ・しょぼいカレンダー）"""

import json
import os
from logic.recordings.segment_calculator import episode_list
from .rec_aug_dups import _dup_for_recording
from .rec_aug_values import _json_or_none, _drop_counts, _confirmed_view  # noqa: F401


def _state_to_action(state):
    if state in ('skipped',):
        return 'skip'
    if state in ('encoded', 'done'):
        return 'encoded'
    return 'encode'


def _cv_str(v):
    """確定値（list or スカラー）を表示/比較用の文字列へ正規化する。
    クライアント側 _aeNorm と同義（list は ', ' 連結）。"""
    if isinstance(v, list):
        return ', '.join('' if x is None else str(x) for x in v)
    return '' if v is None else str(v)


def _shoboi_info(v):
    """記録の shoboi_info(JSON) を辞書へ。まだ引いていなければ None、番組表に無ければ {}。"""
    if not v:
        return None
    try:
        d = json.loads(v) if isinstance(v, str) else v
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


# 話数・副題の値をリストにする（logic.recordings.segment_calculator.episode_list。ほかの API がこの名前で読み込む）
_as_list = episode_list


def _rec_aug_row(rec, programs, dup_map) -> dict:
    """録画1件を、録画一覧の1行の形にする。"""
    is_manual = rec.get('rec_id') is None

    # JSON フィールドのデコード（segments は読めた時だけ。文字列以外の値は来ない）
    raw_segs = rec.get('segments')
    segs = None
    if raw_segs:
        try:
            segs = json.loads(raw_segs)
        except Exception:
            pass
    to_enc = _json_or_none(rec.get('to_encode_info'))

    # file_exist: DB 未設定なら実ファイル確認
    fe = rec.get('file_exist')
    if fe is None:
        _chk = rec.get('app_ts_path') or rec.get('host_ts_path', '')
        if _chk:
            fe = int(os.path.exists(_chk))

    # drops/scrambles: drop_error JSON → なければ EDCB 保存値にフォールバック
    _drops, _scrambles = _drop_counts(rec)

    # 重複表示は保存カラムではなく索引からライブ計算する(video追加/削除・
    # federationピア側の変化へ即追従。保存カラムduplicate_infoは確定値保存時の記録)
    _dup = _dup_for_recording(dup_map, rec) if dup_map else []

    base = {
        'id':                   rec['rec_id'] if not is_manual else rec['id'],
        'rec_file_path':        rec.get('edcb_ts_path') or rec.get('host_ts_path') or '',
        'title':                rec.get('eit_title') or '',
        # 予約(EDCB の EPG)由来の番組名。TS から読んだ title と違う時だけ画面に出す
        'edcb_title':           rec.get('edcb_title') or '',
        # しょぼいカレンダーの番組表・作品情報から引いたこの放送の情報（録画詳細に出す）
        'shoboi_info':          _shoboi_info(rec.get('shoboi_info')),
        'service_name':         rec.get('eit_station_name') or '',
        'onid':                 rec.get('onid'), 'tsid': rec.get('tsid'),
        'sid':                  rec.get('sid'), 'event_id': rec.get('eid'),
        'start_time':           rec.get('eit_start_time'),
        'duration_sec':         rec.get('duration_sec') or 0,
        'drops':                _drops, 'scrambles': _scrambles,
        'rec_status':           rec.get('rec_status'),
        'protect_flag':         False,
        'description':          rec.get('eit_description') or '',
        'extended_info':        rec.get('eit_extended_info') or '',
        'eit_genre':            rec.get('eit_genre') or '',
        # 有料の番組か（利用者ごとの権限で絞る。分からなければ None で、局の大半で決める）
        'is_paid':              rec.get('is_paid'),
        'eit_video_info':       rec.get('eit_video_info') or '',
        'eit_audio_info':       rec.get('eit_audio_info') or '',
        'file_size':            rec.get('file_size'),
        'recording_start_time': rec.get('recording_start_time') or '',
        'recording_end_time':   rec.get('recording_end_time') or '',
        'edcb_tag':             rec.get('edcb_tag') or '',
        'comment':              rec.get('rec_comment') or '',
        'is_text_parser':       rec.get('is_text_parser') or 0,
        'db_rec_id':            rec['id'],
        'segments':             segs,
        'file_exist':           fe,
        'drop_error':           rec.get('drop_error'),
        'eit_overlap':          rec.get('eit_overlap'),
        'to_encode_info':       to_enc,
        'state':                rec.get('state'),
        'scan_cancelled':       1 if rec.get('scan_cancelled') else 0,
        # 別ノードへエンコードを委譲した時の転送の進み具合(転送中は state が変わらない)
        'transfer_state':       _json_or_none(rec.get('transfer_state')),
        'comment_count':        rec.get('comment_count'),
        'duplicate_info':       _dup,
        'is_manual':            is_manual,
        'manual_id':            rec['id'] if is_manual else None,
        'rule_id':              None,
        'tags':                 [],
        'action':               'encode',
        'text_parser_result':   {},
        'parser_error':         [],
        'confirmed':            {},
    }

    program = programs.get(rec['program_id']) if rec.get('program_id') else None
    if program:
        # 録画側に解析結果があればそれ、無ければ予約側のもの
        tpr = program.get('text_parser_result') or {}
        if isinstance(tpr, str):
            try:
                tpr = json.loads(tpr)
            except Exception:
                tpr = {}
        rec_tpr = rec.get('text_parser_result')
        if isinstance(rec_tpr, str):
            try:
                rec_tpr = json.loads(rec_tpr)
            except Exception:
                rec_tpr = None
        if rec_tpr and isinstance(rec_tpr, dict):
            base['text_parser_result'] = rec_tpr
            base['parser_error'] = rec.get('parser_error') or []
        else:
            base['text_parser_result'] = tpr
            base['parser_error'] = program.get('parser_error') or []
        base['tags'] = base['text_parser_result'].get('tags', [])
        base['action'] = _state_to_action(program.get('state', ''))
        base['rule_id'] = program.get('id')
        base['confirmed'] = _confirmed_view(rec)
    elif rec.get('is_text_parser') is not None or rec.get('text_parser_result') or rec.get('parser_error'):
        # 予約の無い録画（他のサーバーから取り込んだ物など）は is_text_parser が空のことがある。
        # 再解析は結果を text_parser_result / parser_error に書くので、それがあれば出す
        # （出さないと、再解析しても録画詳細が「解析結果なし」のままだった）
        pe = rec.get('parser_error')
        if isinstance(pe, str):
            try:
                pe = json.loads(pe)
            except ValueError:
                pe = [pe]
        base['parser_error'] = pe or []
        base['confirmed'] = _confirmed_view(rec)
        raw_tpr = rec.get('text_parser_result')
        if isinstance(raw_tpr, dict) and raw_tpr:
            base['text_parser_result'] = raw_tpr
        elif raw_tpr and isinstance(raw_tpr, str):
            try:
                base['text_parser_result'] = json.loads(raw_tpr)
            except Exception:
                pass
    return base
