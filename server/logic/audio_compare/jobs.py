"""音声比較・まとめて取り込み・ずれの測り直しのジョブ"""

from logic import audio_overlap
from .queue import (  # noqa: F401
    _new_job,
    _submit,
    logger,
)
from .remap import (  # noqa: F401
    build_ranges,
    match_ranges,
)


def start(video_id: int, path_a: str, path_b: str, source: dict, ffmpeg: str, opts: dict):
    """音声比較をバックグラウンドで開始し job_id を返す。

    戻り: ('busy', None) 実行中 / (None, job_id) 正常。
    """
    job_id, _log, _finish = _new_job('compare', video_id, source,
                                     f'audio_compare(video={video_id})')

    def _worker():
        try:
            matches = audio_overlap.analyze(
                path_a, path_b, ffmpeg=ffmpeg, on_log=_log,
                min_match=int(opts.get('min_match') or 10),
                correlation=float(opts.get('correlation') or 0.75),
                resolution=int(opts.get('resolution') or 500),
                refine=bool(opts.get('refine')),
                bridge=opts.get('bridge', True),
            )
            _finish('done', result={'matches': matches, 'source': source})
        except Exception as e:
            _log(f'エラー: {e}')
            logger.exception('audio_compare(video=%s) 失敗', video_id)
            _finish('error', error=str(e))

    _submit(job_id, _worker)
    return None, job_id


def start_full(video_id: int, path_a: str, path_b: str, source: dict,
               ffmpeg: str, opts: dict, apply_fn):
    """音声比較 → ずれの測定 → 映像の確認 → 取り込み まで一度に走らせる。

    全部で3分ほどかかる(実測: 音声比較38秒 + ずれ測定62秒 + 映像確認88秒)ので、
    先に取り込む種別を選んでもらってから後ろでまとめて流す。音声の抽出は
    音声比較とずれ測定で共有する(同じものを2回抽出していた)。

    opts['audio_only'] を立てると音声比較だけで取り込む(40秒ほど)。ずれの分解能は
    500ms(refine で 125ms)までで、無音区間・場面の切り替わりでの確認もしない。
    別方式なので結果も別物になる。速さを取る時のためのもの。

    apply_fn(ranges, video_check, detail) -> dict  取り込みの実処理(呼び出し側が渡す)。
      ranges は remap 用の (b_start, b_end, offset)、detail は refine の生の区間情報。
    戻り: ('busy', None) 実行中 / (None, job_id) 正常。
    """
    import shutil
    import tempfile

    from logic import audio_overlap, frame_sync

    job_id, _log, _finish = _new_job('audio_only' if opts.get('audio_only') else 'full',
                                     video_id, source, f'audio_compare/full(video={video_id})')

    # 急がない処理なので優先度を下げ、負荷が高い間は譲る（CM解析と食い合わないため）
    nice = int(opts.get('nice', frame_sync._NICE))
    max_load = opts.get('max_load')

    def _worker():
        wav_dir = tempfile.mkdtemp(prefix='acmp_')
        try:
            _log(f'音声を比較しています（優先度 -{nice}'
                 + (f' / 負荷 {max_load:.1f} を超えたら待つ）' if max_load else '）'))
            matches = audio_overlap.analyze(
                path_a, path_b, ffmpeg=ffmpeg, on_log=_log, wav_dir=wav_dir, nice=nice,
                min_match=int(opts.get('min_match') or 10),
                correlation=float(opts.get('correlation') or 0.75),
                resolution=int(opts.get('resolution') or 500),
                refine=True, bridge=False)
            if not matches:
                _finish('error', error='共通区間が見つかりませんでした')
                return

            if opts.get('audio_only'):
                # 音声比較の結果をそのまま使う方式。ずれは 500ms(refine で 125ms)刻み
                ranges = match_ranges(matches)
                _log('取り込んでいます（音声比較のみ / ずれの分解能 500ms）')
                added = apply_fn(build_ranges(matches), [], ranges)
                _log('完了しました: ' + (', '.join(
                    f'{k} {v.get("count")}件({v.get("name")})' for k, v in (added or {}).items())
                    or '取り込むものがありませんでした'))
                _finish('done', result={'matches': matches, 'ranges': ranges, 'video': [],
                                        'source': source, 'added': added})
                return

            _log('ずれをサンプル単位で測り直しています')
            ranges = frame_sync.refine(path_a, path_b, matches, ffmpeg=ffmpeg,
                                       on_log=_log, wav_dir=wav_dir,
                                       nice=nice, max_load=max_load)
            video = []
            if opts.get('verify_video', True):
                announce = bool(source.get('announce') or source.get('announce_self'))
                tol = (frame_sync._OK_FRAMES_ANNOUNCE if announce else frame_sync._OK_FRAMES)
                # 判定点は無音＋場面の切り替わり。chapter_txt が無ければ
                # marks_fn が再解析して tag.json へ残す（約25秒）
                marks = opts.get('marks_fn')(_log) if opts.get('marks_fn') else None
                hints = frame_sync.segment_edge_hints(opts.get('trim_segments'), ranges,
                                                      chapter_txt=opts.get('chapter_txt'),
                                                      marks=marks)
                _log(f'映像が同じずれで合っているか確認しています（許容 ±{tol}フレーム'
                     f'{" / 放送異常告知あり" if announce else ""}）')
                # チャプター境界（A と B の細かい方で割る）と、音声の局所確認用の波形
                video = frame_sync.verify_video(
                    path_a, path_b, ranges, ffmpeg=ffmpeg, on_log=_log, tolerance=tol,
                    hints=hints, wav_dir=wav_dir, nice=nice, max_load=max_load,
                    bounds_a=frame_sync.chapter_marks(opts.get('chapter_txt')),
                    bounds_b=opts.get('bounds_b'))

            _log('取り込んでいます')
            added = apply_fn([list(r) for r in frame_sync.to_build_ranges(ranges)],
                             video, ranges)
            _log('完了しました: ' + (', '.join(
                f'{k} {v.get("count")}件({v.get("name")})' for k, v in (added or {}).items())
                or '取り込むものがありませんでした'))
            _finish('done', result={'matches': matches, 'ranges': ranges, 'video': video,
                                    'source': source, 'added': added})
        except Exception as e:
            _log(f'エラー: {e}')
            logger.exception('audio_compare/full(video=%s) 失敗', video_id)
            _finish('error', error=str(e))
        finally:
            shutil.rmtree(wav_dir, ignore_errors=True)

    _submit(job_id, _worker)
    return None, job_id
