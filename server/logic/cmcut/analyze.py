"""解析（analyze）と出力の読み取り（シーン・チャプター・時刻合わせ）"""

import math
import os
import shutil
import time
from .inputs import _frame_table, _now_iso, _to_seconds, _video_info, _work_dir
from .logos import _pick_logos
from .proc import Aborted, _load_aware_workers
from .steps import _channel_setting, _detect_logo_ranges, _detect_mutes_scenes, _run_join_logo_scp, _addon_post_process  # noqa: F401
from .parsers import _tot_mapper, parse_scenes_all_file, parse_chapter_file


def analyze(ts, *, service_id, rec_id=None, recorded_at=None,
            config=None, params=None, log=None):
    """録画TSから CM カット位置を出す。アドオンと録画登録の両方から呼ぶ。

    ts          : 録画TSのパス
    service_id  : サービスID(チャンネル設定の引き当てに使う)
    rec_id      : recordings.id。フレーム表キャッシュの置き場に使う(無くても動く)
    recorded_at : 録画時刻。ロゴの有効期間の判定に使う
    config      : アプリ設定(Amatsukaze の接続先を取る)
    params      : jl / maskratio / jls_engine / keep_work / abort（真を返したら途中で止めて Aborted を投げる）
    log         : 進捗の受け口。省略すると捨てる
    """
    from media.amatsukaze.amatsukaze_files.frames import parse_avs_file
    from media.amatsukaze.amatsukaze_files.jls import parse_jls_file

    params = params or {}
    log = log or (lambda _m: None)
    if not ts or not os.path.exists(ts):
        raise RuntimeError(f'録画TSが見つかりません: {ts}')
    try:
        pass
    except ImportError:
        # 無くても「動く」が、mvec が純Pythonに落ちて 1 フレーム数百秒になる。
        # 黙って何時間も走られると困るのでここで止める
        raise RuntimeError('numba が入っていません（requirements.txt を入れ直してください）。'
                           '無いとシーンチェンジ解析が現実的な時間で終わりません')

    maskratio = float(params.get('maskratio') or 0.35)
    # 並列数と優先度。録画登録スキャンから呼ぶときは絞る（この機械は録画・
    # エンコード・配信を同時にやるので、4コアを取り切ると画面の応答が落ちる）
    want_workers = int(params.get('workers') or 0)
    max_load = params.get('max_load')
    # 並列数は工程ごとに測り直す。1工程が数分あるので、開始時に1回決めるだけだと
    # 途中で負荷が下がっても落としたままになる
    def workers_now():
        return _load_aware_workers(want_workers, max_load, log)
    nice = int(params.get('nice') or 0)
    abort = params.get('abort')
    if abort is not None and abort():
        raise Aborted('始める前に止めました')

    width, height, _ffps, _est = _video_info(ts)
    # 総フレーム数は TS のフレーム表から正確に数える（約7秒）。ffprobe の
    # duration からの見積もりは数十フレームずれ、末尾の Trim の終端が狂う
    # （実測: 見積もり 54096 に対し実数 54064）
    t0 = time.time()
    work = _work_dir(ts)
    os.makedirs(work, exist_ok=True)
    vpts, fidx, tots = _frame_table(rec_id, ts, work)
    nframes = len(vpts)
    if not nframes:
        raise RuntimeError('映像の長さが取れませんでした')
    # 音声を映像に合わせる基準。コンテナの start_time は最初のフレームと
    # 食い違う（実測 0.567秒）ので、ここで数えた先頭フレームの PTS を使う
    vpts0 = vpts[0] / 90000.0
    # fps はフレーム表から出す。ffprobe の r_frame_rate はフィールドレートを
    # 返すことがあり（実測: 29.97 の録画で 59.94）、返り値の秒数が倍ずれる
    fps = ((nframes - 1) * 90000.0 / (vpts[-1] - vpts[0])
           if nframes > 1 and vpts[-1] > vpts[0] else _ffps)
    # フレーム番号 → 秒。プレイヤーの再生時刻(=first_pts 基準)へ揃える。
    # フレーム/fps だとフレーム表の先頭(vpts[0])が原点になり、first_pts と
    # 食い違う録画で全体が一定量ずれる（実測 5フレーム=0.167秒。先頭に
    # フレーム表へ載らないピクチャがあるとその分だけ前にずれる）。
    from media.frame_index.lookup import read_first_pts
    try:
        first_pts = read_first_pts(ts)
    except Exception as e:
        log(f'first_pts が読めないのでフレーム表の先頭を使います: {e}')
        first_pts = vpts[0]
    pts_offset = (vpts[0] - first_pts) / 90000.0

    # 秒は**切り捨て**で3桁にする。四捨五入だと、そのフレームの本当の時刻より
    # 後ろの値になることがあり、UI がその秒からフレーム番号を引き直すと
    # 1つ後ろのフレームになる（time_to_frame は「その時刻以降の最初の
    # フレーム」を返すため）。実測: scenes 148件中79件、
    # mutes 144件中77件が、検出したフレームと画面に出るフレームで食い違って
    # いた。切り捨てなら必ず同じフレームへ戻る（1フレーム=0.042秒 > 0.001秒）。
    def t_at(f):
        i = 0 if f < 0 else (nframes - 1 if f >= nframes else int(f))
        return math.floor((vpts[i] - first_pts) / 90000.0 * 1000) / 1000.0

    log(f'{os.path.basename(ts)}: {width}x{height} {fps:.3f}fps '
            f'{nframes}フレーム（{time.time() - t0:.0f}秒で計数）'
        + (f' 先頭ずれ {pts_offset:+.3f}秒' if abs(pts_offset) >= 0.001 else ''))

    # ── チャンネル設定を Amatsukaze から取る ──
    sid = service_id
    setting = _channel_setting(config, sid)
    # JL は指定が無ければチャンネル設定のもの。局ごとに違う(局ごとの JL ファイルがある)
    jl = str(params.get('jl') or setting.get('jlsCommand') or 'JL_標準.txt')

    when = recorded_at
    logos = _pick_logos(setting, width, height, when, work, log)
    log(f'{setting.get("serviceName")}(SID{sid}) / JL={jl} / '
            + (f'ロゴ {len(logos)} 個: '
               + ", ".join(os.path.basename(p) for p in logos)
               if logos else 'ロゴなし'))
    logof = os.path.join(work, 'logof0.txt')
    chap = os.path.join(work, 'chapter_exe0.txt')
    avs = os.path.join(work, 'trim0.avs')
    jls = os.path.join(work, 'jls0.txt')
    div = os.path.join(work, 'div0.txt')

    try:
        # ── 1. ロゴ判定（ロゴなし局では行わない）──
        ranges = []
        if logos:
            ranges = _detect_logo_ranges(ts, logos, logof, work, fidx, maskratio, workers_now, log, nice, abort)
        else:
            logof = ''      # -inlogo を渡さない＝JL 側の $NOLOGO が真になる

        # ── 2. 無音 + シーンチェンジ ──
        if abort is not None and abort():
            raise Aborted('ロゴ判定の後で止めました')
        _detect_mutes_scenes(ts, chap, nframes, vpts0, fidx, config, workers_now, log, nice, abort)
    except Aborted:
        # 途中の作業場所は使わないので片付ける
        if not params.get('keep_work'):
            shutil.rmtree(work, ignore_errors=True)
        raise

    # ── 3. 構成解析（join_logo_scp）──
    engine = 'py' if str(params.get('jls_engine') or 'python') == 'python' else 'native'
    _run_join_logo_scp(engine, work, jl, chap, avs, jls, div, logof, log)

    trims = parse_avs_file(avs)
    segs = parse_jls_file(jls)
    total = sum(e - s + 1 for s, e in trims)
    log(f'CMカット: {len(trims)} 区間 / 残り {total / fps / 60:.1f}分'
            f'（元 {nframes / fps / 60:.1f}分）')
    for s, e in trims:
        log(f'  {s / fps:8.2f}s - {e / fps:8.2f}s  ({(e - s + 1) / fps / 60:.1f}分)')

    # 消す前に読む。keep_work=False（録画登録スキャン）だと後では開けない
    tot_at = _tot_mapper(vpts, tots)
    mutes, scenes = parse_chapter_file(chap, fps, t_at, tot_at)
    # 復号ついでに chapterexe が出した「切り替わり全部」。分割画面の▼が
    # ここへも飛べるようにする（chapter_exe 本体の出力は1無音1箇所のまま）
    scenes_all = parse_scenes_all_file(chap + '.scenes_all.txt', t_at)

    if not params.get('keep_work'):
        # 取り出した .lgd と JL も消す。残すと rmdir が通らずディレクトリが溜まる
        shutil.rmtree(work, ignore_errors=True)

    result = {
        'version': 1,
        'scenes_all': scenes_all,
        # 秒は first_pts 基準(=プレイヤーの再生時刻)。これが無い結果は
        # フレーム表の先頭基準なので、読む側で pts_offset ぶん足す必要がある
        'time_base': 'first_pts',
        'pts_offset': round(pts_offset, 3),
        'analyzed_at': _now_iso(),
        'work_dir': work if params.get('keep_work') else '',
        'fps': round(fps, 6), 'frames': nframes,
        'logos': [os.path.basename(p) for p in logos],
        'jl': jl, 'jls_engine': engine,
        'service_id': sid, 'service_name': setting.get('serviceName'),
        'logo_ranges': _to_seconds(ranges, t_at, tot_at),
        'trim_segments': _to_seconds(trims, t_at, tot_at),
        # ラベルは :CM / :Trailer(add) など。他と同じく秒を主にする
        'jls_segments': [{'start': round(s / fps, 3), 'end': round(e / fps, 3),
                          'start_frame': s, 'end_frame': e, 'label': lab,
                          'start_tot': tot_at(s), 'end_tot': tot_at(e)}
                         for s, e, _n, lab in segs],
        'kept_sec': round(total / fps, 1),
        'total_sec': round(nframes / fps, 1),
        # 無音区間とシーンチェンジ位置。構成推測の根拠なので、シークバーに
        # 出して「なぜここで切れたか」を追えるように残す
        'mutes': mutes,
        'scenes': scenes,
    }
    return _addon_post_process(result, rec_id, ts, log)


