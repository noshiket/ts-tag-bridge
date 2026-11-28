"""エンコード後の解析の材料（作業フォルダ・チャプター・区間に合わせる）"""

import glob as _glob
import json
import os
from logic.storage.path_translator import container_to_host
from .common import logger
from .trim.cmcheck import _cm_jls_segments
from .trim.avs import _parse_trim_mode_segments, parse_chapter_names
from .trim.chapters import chapter_txt_from_trim
from .comment_trim import _parse_pts_gaps, _scale_gaps_to_actual, _trim_comments
from .tot_trim import _refetch_comments
from .caption_drop_trim import _trim_captions, _trim_drop_error


def _discover_amt_dir(db, enc_id, encode_info, amz_vols):
    """outputs.dstPath 内の amt* ディレクトリを探す。見つかれば encode_info に入れて保存する。"""
    outputs = encode_info.get('outputs', [])
    if isinstance(outputs, dict):
        outputs = [outputs]
    for out in outputs:
        dst_amz = out.get('dstPath', '').rstrip('/')
        dst_app = container_to_host(dst_amz, amz_vols) if dst_amz else None
        if dst_app and os.path.isdir(dst_app):
            amt_candidates = sorted(_glob.glob(os.path.join(dst_app, 'amt*')))
            amt_candidates = [d for d in amt_candidates if os.path.isdir(d)]
            if amt_candidates:
                amt_dir_app = amt_candidates[0]
                encode_info['amt_dir'] = amt_dir_app
                db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
                logger.info('run_encoded_analyze: enc_id=%d amt_dir discovered: %s', enc_id, amt_dir_app)
                return amt_dir_app
    return None


def _load_chapter_txt(db, enc, encode_info, amz_vols, is_addon, input_ts_amz):
    """chapter.txt の中身。アドオンは戻り値、Amatsukaze は outputs.dstPath/stem(input_ts).chapter.txt。
    trim モードなら採用区間から作り直したものを使う。"""
    enc_id = enc['id']
    chapter_txt_content = encode_info.get('addon_chapter_txt') if is_addon else None
    if input_ts_amz and not is_addon:
        _stem = os.path.splitext(os.path.basename(input_ts_amz))[0]
        _outputs = encode_info.get('outputs', [])
        if isinstance(_outputs, dict):
            _outputs = [_outputs]
        if _outputs:
            _dst_amz = _outputs[0].get('dstPath', '').rstrip('/')
            _dst_app = container_to_host(_dst_amz, amz_vols) if _dst_amz else None
            if _dst_app:
                _chapter_path = os.path.join(_dst_app, f'{_stem}.chapter.txt')
                if os.path.exists(_chapter_path):
                    try:
                        with open(_chapter_path, encoding='utf-8') as _f:
                            chapter_txt_content = _f.read()
                        logger.debug('run_encoded_analyze: enc_id=%d chapter.txt loaded (%d bytes)',
                                    enc_id, len(chapter_txt_content))
                    except Exception as e:
                        logger.warning('run_encoded_analyze: chapter.txt read failed enc_id=%d: %s', enc_id, e)

    # trimモード: chapter.txt は実際にカットする採用区間から導出する。
    # Amatsukaze のものは Amatsukaze 自身の CM判定に基づくので、分割画面で
    # 採用区間を手で直した時に食い違う（名前の付け方は amz_chapter_names で再現済み）
    if not is_addon:
        _trim_spec = _parse_trim_mode_segments(enc.get('segments'))
        if _trim_spec:
            _derived = chapter_txt_from_trim(
                _trim_spec, _cm_jls_segments(db, enc), chapter_txt_content or '',
                parse_chapter_names(enc.get('segments')))
            if _derived:
                chapter_txt_content = _derived
                logger.info('run_encoded_analyze: enc_id=%d chapter.txt を採用区間から導出 (%d章)',
                            enc_id, _derived.count('NAME='))
    return chapter_txt_content


def _trim_to_segments(enc, trim_segs, encoded_duration) -> dict:
    """コメント・字幕・ドロップ情報を採用区間に切り詰める（受信断のぶんは位置から差し引く）。"""
    rec_start_time = enc.get('recording_start_time')
    # 受信断で記録されていない区間。TOT差分だけで位置を出すと、ここより後ろが全部ずれる
    pts_gaps           = _parse_pts_gaps(enc.get('drop_error'))
    _detected          = sum(g[1] for g in pts_gaps)
    pts_gaps           = _scale_gaps_to_actual(pts_gaps, trim_segs, encoded_duration)
    if pts_gaps:
        logger.info('run_encoded_analyze: 受信断 %d箇所 検出%.1f秒 → 実損失に合わせて%.1f秒 を'
                    '字幕・コメント位置から差し引きます',
                    len(pts_gaps), _detected, sum(g[1] for g in pts_gaps))
    # 受信断として説明できない食い違いが残る場合。字幕・コメントはトリム区間を基準に
    # 置くので、実尺と違うぶんだけ後ろへずれる（実例: 入力が既にCMカット済みのTSだった
    # ぬきたしで、区間1440秒に対し実尺1283秒。コメント187件中19件が尺外に出た）。
    # 直せないが、後から気づけるよう残す
    _trim_total = sum(float(sg.get('duration_sec') or 0) for sg in (trim_segs or []))
    _lost = sum(g[1] for g in pts_gaps)
    if _trim_total > 0 and encoded_duration:
        _gap = _trim_total - _lost - encoded_duration
        if abs(_gap) > max(2.0, _trim_total * 0.02):
            logger.warning('run_encoded_analyze: トリム区間(%.1f秒)と出力の実尺(%.1f秒)が'
                           '%.1f秒 食い違います。字幕・コメントがこのぶんずれます'
                           '（入力が録画そのものでない/CMカットで本編が削られた等）',
                           _trim_total, encoded_duration, _gap)
    comments_src       = _refetch_comments(enc, trim_segs)
    comments_trimmed   = _trim_comments(comments_src,             trim_segs, rec_start_time, pts_gaps)
    captions_trimmed   = _trim_captions(enc.get('captions_json'),  trim_segs, pts_gaps)
    captions2_trimmed  = _trim_captions(enc.get('captions2_json'), trim_segs, pts_gaps)
    drop_error_trimmed = _trim_drop_error(enc.get('drop_error'),   trim_segs,
                                          rec_start_time, enc.get('recording_end_time'))

    # comment_count 再計算
    comment_count = None
    if comments_trimmed:
        try:
            cd = json.loads(comments_trimmed)
            if isinstance(cd, dict):
                comment_count = len(cd.get('comments', []))
        except Exception:
            pass
    return {'comments': comments_trimmed, 'captions': captions_trimmed, 'captions2': captions2_trimmed,
            'drop_error': drop_error_trimmed, 'comment_count': comment_count}
