"""エンコード後の確かめと仕上げ（中身・長さ・サムネイル・tag.json）"""

import json
import os
from media.probe.ffprobe import get_video_info
from media.tsukujima.thumbnail_generator import ThumbnailGenerator
from .common import logger
from .encoded_output import _split_range_total_sec
from .tag_json import _update_tag_json, _write_tag_json
from .step_file_copy import _fetch_announce, _telop_announce


def _probe_encoded(enc_id, encoded_path, ffprobe_path, encoded_duration):
    """エンコード済みファイルの (映像の情報, 音声の情報, 大きさ, フレーム表)。ファイルが無ければ全部 None。"""
    video_info_dict = None
    audio_info_list = None
    encoded_file_size = None
    frame_table = None      # コマ送り用のフレーム表(tag.json へ入れる)
    if not encoded_path:
        return video_info_dict, audio_info_list, encoded_file_size, frame_table

    probe_result = get_video_info(ffprobe_path, encoded_path)
    if probe_result:
        video_info_dict = probe_result.get('video')
        audio_info_list = probe_result.get('audio')

    # コマ送り用のフレーム表(表示時刻の一覧)。エンコード結果は可変フレームレートに
    # なることがあり(本編24p + テロップ30p 等)、1/30秒ずつ動かす決め打ちでは合わない。
    # moov のサンプル表を読むだけなのでデコード不要・1秒未満で終わる。
    try:
        from media import mp4_frames
        frame_table = mp4_frames.build(encoded_path, ffprobe_path)
        if frame_table:
            logger.debug('run_encoded_analyze: enc_id=%d フレーム表 %s',
                        enc_id, mp4_frames.summary(frame_table))
    except Exception as e:
        logger.warning('run_encoded_analyze: フレーム表の生成に失敗(無視) enc_id=%d: %s', enc_id, e)

    try:
        encoded_file_size = os.path.getsize(encoded_path)
    except OSError:
        pass

    logger.debug('run_encoded_analyze: enc_id=%d media: video=%s audio_tracks=%d size=%s dur=%s',
                 enc_id, video_info_dict is not None,
                 len(audio_info_list) if audio_info_list else 0,
                 encoded_file_size, encoded_duration)
    return video_info_dict, audio_info_list, encoded_file_size, frame_table


def _check_output_duration(enc, trim_segs, encoded_duration, encoded_path):
    """エンコード出力の尺がおかしければ、その理由（エラーの文言）を返す。問題なければ None。"""
    # ── 整合性チェック: エンコード出力尺が指定セグメント尺を超えていないか ──
    # 残骸ファイル混入・trim 未適用・誤った TS のエンコード等を検出する。
    # 指定セグメント尺 = trim_segments の合計（CMカット後の本編尺）。
    expected_seg_dur = None
    if trim_segs:
        expected_seg_dur = sum((s.get('duration_sec') or 0) for s in trim_segs)
    _DUR_TOLERANCE = 10.0  # 秒（コンテナ/フレーム端数の許容）
    if (encoded_duration is not None and expected_seg_dur and expected_seg_dur > 0
            and encoded_duration > expected_seg_dur + _DUR_TOLERANCE):
        return (f'エンコード出力尺 {encoded_duration:.1f}s が指定セグメント尺 '
                f'{expected_seg_dur:.1f}s を超過（出力ファイル不正の疑い: {encoded_path}）')

    # ── split 指定範囲の超過チェック ──
    # エンコード出力は split した cut.ts の尺（split 指定範囲）を超えられない。
    # 例: split 30分なのに出力 60分 → 別TS混入・残骸ファイル等の不正。trim_segs が空でも効く独立チェック。
    split_total = _split_range_total_sec(enc.get('segments'))
    if (encoded_duration is not None and split_total and split_total > 0
            and encoded_duration > split_total + _DUR_TOLERANCE):
        return (f'エンコード出力尺 {encoded_duration:.1f}s が split 指定範囲 '
                f'{split_total:.1f}s を超過（出力ファイル不正の疑い: {encoded_path}）')
    return None


def _generate_thumbnails(db, enc, encode_info, encoded_path, encoded_duration, trim_segs, config,
                         final_thumbnail_path):
    """サムネイルを作る。できたらコピー元のパスを encode_info に保存し、tag.json 用の情報を返す。"""
    enc_id = enc['id']
    thumbnail_info_dict = None
    try:
        ffmpeg_path = (config or {}).get('ffmpeg', 'ffmpeg')
        recording = db.get_recording(enc['recording_id'])
        eit_genre_str = (recording.get('eit_genre') or '') if recording else ''
        gen = ThumbnailGenerator.from_encoding(
            encoded_path, encoded_duration, trim_segs, eit_genre_str, ffmpeg_path
        )
        src_thumbnail, src_thumbnail_tile = gen.generate_and_save()
        if src_thumbnail:
            encode_info['thumbnail_path'] = src_thumbnail
            encode_info['thumbnail_tile_path'] = src_thumbnail_tile
            db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
            rep_w, rep_h = gen.SCORING_SCALE
            thumbnail_info_dict = {
                'version': 1,
                'representative': {'format': 'WebP', 'width': rep_w, 'height': rep_h},
            }
            if src_thumbnail_tile:
                tw, th = gen.TILE_SCALE
                thumbnail_info_dict['tile'] = {
                    'format': 'WebP',
                    'image_width': gen.tile_image_width,
                    'image_height': gen.tile_image_height,
                    'tile_width': tw,
                    'tile_height': th,
                    'total_tiles': gen.total_tiles,
                    'column_count': gen.tile_cols,
                    'row_count': gen.tile_rows,
                    'interval_sec': gen.tile_interval_sec,
                }
        logger.info('run_encoded_analyze: enc_id=%d thumbnails src=%s final=%s',
                    enc_id, src_thumbnail if src_thumbnail else None, final_thumbnail_path)
    except Exception as e:
        logger.warning('run_encoded_analyze: thumbnail generation failed enc_id=%d: %s', enc_id, e)
    return thumbnail_info_dict


def _update_primary_tag(db, enc, tag_path, trim_segs, trimmed, **media):
    """一次ファイルの tag.json を更新する。無ければ make_DB と同様に作ってから。"""
    enc_id = enc['id']
    # 存在しない場合は make_DB と同様に再生成
    if not os.path.exists(tag_path):
        try:
            recording_for_tag = db.get_recording(enc['recording_id'])
            if recording_for_tag:
                ep_idx = enc.get('episode_idx', 0) or 0
                rec_for_tag = dict(recording_for_tag)
                segs_raw = rec_for_tag.get('segments')
                if isinstance(segs_raw, str):
                    try:
                        rec_for_tag['segments'] = json.loads(segs_raw)
                    except Exception:
                        pass
                _write_tag_json(tag_path, rec_for_tag, ep_idx)
                logger.info('run_encoded_analyze: enc_id=%d tag.json created (fallback)', enc_id)
        except Exception as e:
            logger.warning('run_encoded_analyze: tag.json create failed enc_id=%d: %s', enc_id, e)
    if os.path.exists(tag_path):
        try:
            # しょぼいカレンダーの放送異常告知(テロップ・繰り下げ等)をtagへ記録。
            # 告知が取れない/告知なしでも、文字スーパー(地震速報等)が動画に残っていれば
            # 実測でテロップ放送と分かるのでそちらを入れる(しょぼいの文言があれば優先)
            announce = _fetch_announce(enc)
            if not announce or str(announce).startswith('none'):
                announce = _telop_announce(trimmed['captions2']) or announce
            _update_tag_json(tag_path, trim_segs, trimmed['comments'],
                             trimmed['captions'], trimmed['captions2'], trimmed['drop_error'],
                             video_info=media['video_info'], audio_info=media['audio_info'],
                             file_size=media['file_size'], duration_sec=media['duration_sec'],
                             thumbnail_path=media['thumbnail_path'], thumbnail_tile_path=media['thumbnail_tile_path'],
                             thumbnail_info=media['thumbnail_info'],
                             chapter_txt=media['chapter_txt'],
                             announce=announce, frame_table=media['frame_table'],
                             src_captions_json=enc.get('captions_json'),
                             src_captions2_json=enc.get('captions2_json'))
        except Exception as e:
            logger.warning('run_encoded_analyze: tag update failed enc_id=%d: %s', enc_id, e)
