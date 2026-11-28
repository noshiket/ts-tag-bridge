"""CM 解析の各工程（局の設定・ロゴ・無音と場面・join_logo_scp・アドオンの後処理）"""

import data_paths
import os
import time
from .inputs import _JL_DIR, service_setting
from .logos import _fetch_jl_dir
from .proc import _run_module, _thirdparty_module


def _channel_setting(config, sid):
    """Amatsukaze のチャンネル設定。無い・CMカット無効なら止める。"""
    setting = service_setting(config, sid)
    if setting is None:
        raise RuntimeError(f'SID{sid} のチャンネル設定が Amatsukaze にありません。'
                           '一度エンコードして局を認識させてください')
    if setting.get('disableCMCheck'):
        raise RuntimeError(f'{setting.get("serviceName")} は Amatsukaze 側で'
                           'CMカット無効に設定されています')
    return setting


def _detect_logo_ranges(ts, logos, logof, work, fidx, maskratio, workers_now, log, nice, abort=None):
    """ロゴ判定（全フレームを走査する）。ロゴが出ていたフレームの区間を返す。"""
    from media.amatsukaze.amatsukaze_files.logo_times import parse_logo_file
    log('ロゴ判定を開始します（全フレーム走査するため時間がかかります）')
    t0 = time.time()
    nfile = os.path.join(work, 'frames.txt')
    _run_module('logoframe_py',
                ['--input', ts, '--logo', *logos, '-o', logof,
                 '--maskratio', str(maskratio), '--frames-out', nfile,
                 '--vpts-file', fidx]
                + (lambda w: ['--threads', str(w)] if w else [])(workers_now()),
                log, nice, abort)
    ranges = parse_logo_file(logof)
    with open(nfile) as f:
        nscan = int(f.read().strip())
    os.remove(nfile)
    log(f'ロゴ判定 完了 {time.time() - t0:.0f}秒 / ロゴ区間 {len(ranges)} 個 '
            f'/ 走査 {nscan} フレーム')
    return ranges


def _detect_mutes_scenes(ts, chap, nframes, vpts0, fidx, config, workers_now, log, nice, abort=None):
    """無音区間とシーンチェンジを chapter_exe で探し、chap に書く。"""
    log('無音区間とシーンチェンジの解析を開始します')
    t1 = time.time()
    # 探索窓(extendmute)。chapter_exe の既定は 1フレームで、無音の前後1枚しか
    # 見ない。本当の切れ目が無音の終わりより後ろにあると窓の外になり、窓の中で
    # いちばんそれらしい所を SCPos にしてしまう。
    # 実測（無音25箇所）: 窓の中に切れ目があったのは20箇所、外が5箇所で
    # はみ出しは +19〜+22フレーム（約0.9秒、いずれも無音の後ろ側）。
    _emute = int((config or {}).get('cmcut_extendmute') or 24)
    _run_module('chapterexe_py',
                ['-v', ts, '-o', chap, '--frames', str(nframes),
                 '-e', str(_emute),
                 '--vpts', '%.9f' % vpts0, '--vpts-file', fidx]
                + (lambda w: ['--threads', str(w)] if w else [])(workers_now()),
                log, nice, abort)
    log(f'シーンチェンジ解析 完了 {time.time() - t1:.0f}秒')


def _run_join_logo_scp(engine, work, jl, chap, avs, jls, div, logof, log):
    """構成解析（join_logo_scp）。CM を除いた区間を avs に、構成を jls に書く。"""
    # 本物の join_logo_scp は Amatsukaze のコンテナの中にある。コンテナはホストの / を
    # /host-rootfs に見せている（joinlogoscp_py はこの2つを環境変数で受け取る）
    os.environ.setdefault('JLS_DOCKER_CONTAINER', 'amatsukaze')
    os.environ.setdefault('JLS_DOCKER_HOST_ROOT', '/host-rootfs')
    joinlogoscp_py = _thirdparty_module('joinlogoscp_py')
    if engine == 'py':
        # Python 実装はホスト上の JL を読むのでコンテナから取り出しておく
        incmd = os.path.join(_fetch_jl_dir(work), jl)
        if not os.path.exists(incmd):
            raise RuntimeError(f'JL が見つかりません: {jl}')
    else:
        if not joinlogoscp_py.available_native():
            raise RuntimeError('join_logo_scp が使えません（Amatsukaze コンテナが動いていますか）')
        incmd = f'{_JL_DIR}/{jl}'
    log(f'構成解析を開始します（engine={engine}）')
    r = joinlogoscp_py.run(inscp=chap, incmd=incmd, out_avs=avs,
                           oscp=jls, odiv=div, inlogo=logof, engine=engine)
    if r.returncode != 0 or not os.path.exists(avs):
        raise RuntimeError(f'join_logo_scp が失敗しました: {r.stderr.strip() or r.stdout.strip()}')
    for ln in (r.stderr or '').splitlines():
        if ln.strip():
            log(f'  {ln.strip()}')


def _addon_post_process(result, rec_id, ts, log):
    """録画の素性によっては解析結果に直しが要る（配信の取り込みは CM を捨てて録るので
    PTS に穴が残り、フレーム番号を PTS で秒へ直すと位置がずれる）。素性ごとの処理は
    アドオンに置き、ここでは口だけ用意する。失敗したら直さずに返す。"""
    try:
        from logic.addons import addon_runner
        rec = None
        if rec_id is not None:
            from logic.addons import addon_events
            rdb = (addon_events.app_context() or {}).get('rule_db')
            if rdb is None:
                # サーバーの外（保守用スクリプト等）から呼ばれた場合。文脈が無いと
                # 録画の素性が判らず、アドオンが素通りしてしまう（実測: ある録画を
                # 手で解析し直したら cm_gaps が付かなかった）。DB を直に開く
                from db.rule_db.core import ProgramDB
                data_dir = data_paths.DATA_DIR
                rdb = ProgramDB(os.path.join(data_dir, 'rules.db'))
            rec = rdb.get_recording(rec_id)
        result = addon_runner.run_cm_analysis(result, rec, ts, log=log)
    except Exception as e:
        if log:
            log(f'CM解析の後処理に失敗（無視して続けます）: {e}')
    return result
