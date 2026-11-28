"""音楽ファイル（AIFF 等）をライブラリへ取り込む。

ブラウザが AIFF を再生できない（Safari のみ）ことと、iOS の PiP が映像トラックを
要求する（音声だけでは PiP に入れず、背景に回ると音が止まる）ことは、どちらも
「ジャケットの静止画を映像トラックに持つ MP4」を1本作れば同時に片付く。
そこで原本から再生用 MP4 を作り、それを app_output_path として tag.json 登録する。
原本は消さずに source_path として残す。

ライブラリの3階層はアーティスト(album) > アルバム(series) > 曲(video) に対応させる。
"""

import json
import logging
import os

from media.probe.media_tags import get_media_tags
from .music_media import NICE, cover_path, extract_cover, build_play_mp4, LOSSLESS_PCM, archive_path, build_archive
from .music_tags import build_tag

logger = logging.getLogger(__name__)

# 取り込む拡張子。原本が .mp4/.m4a でも映像トラックが要るので変換対象に含める。
AUDIO_EXTS = ('.aiff', '.aif', '.flac', '.mp3', '.m4a', '.wav', '.opus', '.ogg')


def is_audio(path: str) -> bool:
    return path.lower().endswith(AUDIO_EXTS)


def is_generated(name: str) -> bool:
    """取り込みが作ったファイルか（原本の隣に置いた時、次の走査で拾わないため）。

    可逆の控え <stem>.src.flac は音声ファイルなので、除かないと2回目の走査で
    「新しい曲」として取り込んでしまう。
    """
    return '.src.' in name or '.cover.' in name or '.thumbnail.' in name


def scan_dir(root: str) -> list:
    """フォルダを再帰で見て、取り込める音声ファイルを並べる（何も書かない）。"""
    found = []
    for dirpath, _dirs, files in os.walk(root):
        for name in sorted(files):
            if is_audio(name) and not name.startswith('.') and not is_generated(name):
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def play_path(src: str) -> str:
    """再生用 MP4 の置き場所。原本と同じフォルダに置く。"""
    stem, ext = os.path.splitext(src)
    return stem + ('.play.mp4' if ext.lower() == '.mp4' else '.mp4')


def plan(ffprobe: str, src: str, dest_fn=None) -> dict:
    """1曲ぶんのタグを読んで tag.json の中身を組み立てる（まだ何も書かない）。

    dest_fn(tag) -> パス を渡すと置き場所をそれで決める（app_output_path_format を
    encode_dir 配下へ展開する）。渡さなければ原本の隣に置く。
    """
    tags = get_media_tags(ffprobe, src)
    tag = build_tag(src, play_path(src), tags)
    # ジャケットの有無と形式は読み取り時にしか分からない。convert が取り出す時に使い、
    # tag.json へは残さない（先頭が _ のキーは convert が落とす）
    tag['_cover'] = bool(tags.get('cover'))
    tag['_cover_codec'] = tags.get('cover_codec') or ''
    if dest_fn:
        dest = dest_fn(tag)
        if dest:
            tag['app_output_path'] = dest
    return tag


def start_import(db, ffmpeg: str, ffprobe: str, files: list, dest_fn=None, nice=NICE) -> str:
    """まとめて取り込むジョブを積んで job_id を返す。

    変換は CPU を食うので、音声解析と同じ順番待ち（同時1本）に載せる。
    1曲ごとに「変換 → サムネ → tag.json → add_videos」まで済ませ、
    途中で失敗した曲があっても残りは続ける（失敗は件数と最後の理由を出す）。
    dest_fn は置き場所を決める関数（app_output_path_format の展開。plan を参照）。
    """
    from logic import audio_compare

    def _run(log, finish):
        added, skipped, failed, last_error = [], 0, 0, ''
        for i, src in enumerate(files, 1):
            name = os.path.basename(src)
            try:
                tag = plan(ffprobe, src, dest_fn)
            except Exception as e:
                failed += 1
                last_error = str(e)
                log(f'({i}/{len(files)}) {name}: 失敗 — {e}')
                continue
            dup = (db.find_video_by_path(tag['app_output_path'])
                   or db.find_video_by_music_key(tag.get('music_key') or ''))
            if dup:
                skipped += 1
                log(f'({i}/{len(files)}) {name}: 登録済みなので飛ばします (id={dup})')
                continue
            try:
                log(f'({i}/{len(files)}) {name} を変換しています')
                added.append(db.add_videos(convert(ffmpeg, tag, nice=nice)))
            except Exception as e:
                failed += 1
                last_error = str(e)
                logger.exception('music_import: %s の取り込みに失敗', src)
                log(f'({i}/{len(files)}) {name}: 失敗 — {e}')
        log(f'完了しました: 取り込み {len(added)}曲'
            + (f' / 飛ばした {skipped}曲' if skipped else '')
            + (f' / 失敗 {failed}曲' if failed else ''))
        finish('done', result={'added': len(added), 'skipped': skipped,
                               'failed': failed, 'video_ids': added,
                               'error': last_error})

    return audio_compare.start_job('music_import', None,
                                   {'name': f'{len(files)}曲'}, _run)


def convert(ffmpeg: str, tag: dict, nice=NICE) -> dict:
    """plan() で決めた置き場所へ 再生用MP4 + サムネ + ジャケット + tag.json を書く。

    ジャケットは原寸のまま残す。再生用MP4 とサムネに入っているのは 16:9 に合成した絵で、
    原本(AIFF等)を消すと原寸の画像がどこにも無くなってしまうため。
    """
    src, out_mp4 = tag['source_path'], tag['app_output_path']
    os.makedirs(os.path.dirname(out_mp4) or '.', exist_ok=True)
    stem = os.path.splitext(out_mp4)[0]
    # 先頭が _ のキーは plan からの申し送りで、tag.json には残さない
    has_cover, cover_codec = tag.pop('_cover', False), tag.pop('_cover_codec', '')
    for k in [k for k in tag if k.startswith('_')]:
        del tag[k]
    cover = (extract_cover(ffmpeg, src, cover_path(out_mp4, cover_codec), nice=nice)
             if has_cover else None)
    build_play_mp4(ffmpeg, src, out_mp4, cover, stem + '.thumbnail.webp', nice=nice,
                   duration=float(tag.get('duration_sec') or 0))
    if cover:
        tag['cover_path'] = cover
    # 再生画面の波形/スペクトラム用のデータ（音の通り道に触らずに描くため先に作る）
    try:
        from media import audio_viz
        audio_viz.build(ffmpeg, out_mp4, nice=nice)
    except Exception as e:
        logger.warning('music_import: 波形データを作れませんでした %s: %s', out_mp4, e)
    # 原本を消しても戻せるよう、可逆の控えを隣に置く
    arc = build_archive(ffmpeg, src, archive_path(out_mp4, src), nice=nice)
    tag['archive_path'] = arc
    tag['archive_lossless'] = os.path.splitext(src)[1].lower() in LOSSLESS_PCM or \
        os.path.splitext(src)[1].lower() in ('.flac', '.alac')
    thumb = stem + '.thumbnail.webp'
    if os.path.exists(thumb):
        tag['thumbnail_path'] = thumb
    try:
        tag['file_size'] = os.path.getsize(out_mp4)
    except OSError:
        pass
    with open(out_mp4 + '.tag.json', 'w', encoding='utf-8') as f:
        json.dump(tag, f, ensure_ascii=False, indent=2)
    return tag


def import_one(ffmpeg: str, ffprobe: str, src: str, dest_fn=None, nice=NICE) -> dict:
    """1曲ぶん: タグ読み取り → 置き場所を決める → 変換して tag.json を書く。"""
    return convert(ffmpeg, plan(ffprobe, src, dest_fn), nice=nice)
