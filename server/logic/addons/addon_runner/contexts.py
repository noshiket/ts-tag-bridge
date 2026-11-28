"""アドオンの run(ctx, params) に渡す ctx（動画・エンコーダ）"""

import os
import json
import logging
from datetime import datetime

logger = logging.getLogger('logic.addons.addon_runner')   # 分ける前と同じ名前で出す


# ---------------------------------------------------------------------------
# ctx
# ---------------------------------------------------------------------------

class VideoAddonContext:
    """video対象アドオンの実行コンテキスト。rules.db/video.dbへ直接アクセスできる。"""

    def __init__(self, video_id, video, tag, tag_path,
                 video_db, rule_db, users_db, config, log_fn):
        self.video_id = video_id
        self.video = video          # videosテーブルの行(dict)
        self.tag = tag              # tag.json(dict)
        self.tag_path = tag_path
        self.video_db = video_db
        self.rule_db = rule_db
        self.config = config
        self._users_db = users_db
        self.log = log_fn           # ctx.log('...') → ジョブログ(UI表示)

    def save_tag(self, tag=None):
        """tag.jsonへ保存する(省略時はctx.tag)。"""
        tag = tag if tag is not None else self.tag
        tmp = self.tag_path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(tag, f, ensure_ascii=False, indent=2, default=str)
        os.replace(tmp, self.tag_path)
        self.tag = tag

    def apply_tag_to_db(self):
        """tag.jsonの内容をvideo.dbへ再取込する(add_videos replace)。
        idが変わった場合は視聴履歴リンクを張り替え、新しいvideo_idを返す。"""
        def _remap(old_id, new_id):
            if self._users_db is None or not new_id or old_id == new_id:
                return
            try:
                self._users_db.remap_video_watch_history(old_id, new_id)
            except Exception as e:
                logger.warning('視聴履歴の付け替えに失敗 video %s → %s: %s', old_id, new_id, e)
        new_id = self.video_db.add_videos(self.tag_path, replace=True, on_replace=_remap)
        self.video_id = new_id
        self.video = self.video_db.get_video_row(new_id) or self.video
        return new_id


class EncoderAddonContext:
    """target='encoder' アドオンの実行コンテキスト。

    アドオンは input_ts(分割済みcut.ts)を output_dir へエンコードし、
    {'output_path': str, 'trim_segments': [...], 'chapter_txt': str|None} を返す。
    trim_segments は必須(CMカットしない場合は full_trim_segments() を使う)。
    以降のTOTトリム・ffprobe・サムネ・tag.json・DB登録・転送は本体が行う。
    """

    def __init__(self, enc, recording, input_ts, output_dir, output_stem, source_ts,
                 config, rule_db, video_db, log_fn, step_fn, abort_fn):
        self.enc = enc                  # encodings行(dict)
        self.recording = recording      # recordings行(dict)
        self.input_ts = input_ts        # 分割済みTS(tmp_dir/cut.ts)の実パス
        self.output_dir = output_dir    # 出力先ディレクトリ(存在保証済み)
        self.output_stem = output_stem  # 拡張子なしの推奨ファイル名
        self.source_ts = source_ts      # 元TS(分割前)
        self.config = config
        self.rule_db = rule_db
        self.video_db = video_db
        self.log = log_fn               # ctx.log('...') → 進捗ログ(UI表示)
        self.step = step_fn             # ctx.step('encode', 0.42) → ステップ名+進捗(0..1)
        self.should_abort = abort_fn    # 長時間処理はこれを見て中断する
        # この話数の区間(分割済みなら分割後の値)
        self.recording_start_time = enc.get('recording_start_time') or recording.get('recording_start_time')
        self.recording_end_time = enc.get('recording_end_time') or recording.get('recording_end_time')
        self.duration_sec = self._calc_duration()

    def _calc_duration(self):
        """尺(秒)。録画時刻から出し、無ければ recordings.duration_sec を使う。

        配信の取り込みは recording_start_time /
        recording_end_time が空なので、ここが None になっていた。尺が分からない
        と、解像度が混ざる入力の検出(qsvenc_hevc._mixed_resolution)が先頭1点しか
        見ずに素通りし、QSVEncC が最初の解像度で固定して以降を左上で切り取る。
        実測: 先頭だけ 1280x720、30秒以降は全部 1920x1080 で、
        出来上がりが 1280x720 の切り取られた絵になっていた。
        """
        try:
            s = datetime.fromisoformat(self.recording_start_time)
            e = datetime.fromisoformat(self.recording_end_time)
            return (e - s).total_seconds()
        except Exception:
            pass
        try:
            v = float((self.recording or {}).get('duration_sec') or 0)
            return v if v > 0 else None
        except (TypeError, ValueError):
            return None

    def full_trim_segments(self):
        """CMカットしない場合の trim_segments(全体1区間)。既存と同形式(TOT絶対時刻)。"""
        if not self.recording_start_time or not self.recording_end_time:
            raise ValueError('recording_start_time/recording_end_time が無いため'
                             ' full_trim_segments() を作れません')
        return [{
            'start': self.recording_start_time,
            'end': self.recording_end_time,
            'duration_sec': self.duration_sec,
        }]
