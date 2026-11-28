"""動画に掛けるアドオンをエンコードの仕事として動かす"""

import json
import time
from ..common import logger


def _run_video_addon_job(db, enc, config: dict) -> None:
    """video.db の動画にアドオンを掛ける仕事を1件処理する。

    同じ待ち行列に載せるのは、変換もエンコードも QSV を長時間使うため。
    別々に走らせると食い合う（実測: あるエンコードが90%の最中に
    動画の形式を変えるアドオンが始まった）。エンコードの実行は1件ずつ処理するので、ここへ入れれば
    順番・一時停止・進捗の仕組みがそのまま効く。

    コアにアドオン固有の分岐は書かない。名前と引数は行に入っているものを
    そのまま addon_runner へ渡すだけ。
    """
    from logic.addons import addon_runner
    enc_id = enc['id']
    name = enc.get('addon_name') or ''
    video_id = enc.get('video_id')
    try:
        params = json.loads(enc.get('addon_params') or '{}')
    except (json.JSONDecodeError, TypeError):
        params = {}
    logger.info('run_one_encoding: enc_id=%d アドオン %s を video=%s に掛けます',
                enc_id, name, video_id)
    db.update_encoding(enc_id, state='encoding', progress=0.0, error_message=None)

    # アドオンのログを encode_info.addon_log へ残す。コンソールの口
    # (/encode/encodings/<id>/console) はこれを見るので、書かないと画面が
    # 「ログを取得中…」のまま動かない。行ごとに書くと DB を叩きすぎるので
    # 2秒に1回にまとめる。
    _lines, _last = [], [0.0]

    def _keep_log(msg, force=False):
        _lines.append(str(msg))
        del _lines[:-400]                      # 直近400行だけ持つ
        now = time.time()
        if not force and now - _last[0] < 2.0:
            return
        _last[0] = now
        try:
            cur = json.loads((db.get_encoding(enc_id) or {}).get('encode_info') or '{}')
        except (ValueError, TypeError):
            cur = {}
        cur['addon_log'] = list(_lines)
        db.update_encoding(enc_id, encode_info=json.dumps(cur, ensure_ascii=False)[:100000])

    try:
        res = addon_runner.run_video_addon_sync(
            name, video_id, params, config,
            # encodings.progress は 0〜1（Amatsukaze の進捗に合わせた単位。
            # 画面は progress*100 で出す）。アドオンのログは「N%」なので100で割る。
            # 割らずに入れていたため 200% などと出ていた。
            on_progress=lambda pct: db.update_encoding(
                enc_id, progress=min(1.0, max(0.0, float(pct) / 100.0))),
            on_log=lambda m: (logger.info('enc=%d %s', enc_id, m), _keep_log(m)))
    except Exception as e:
        logger.exception('run_one_encoding: enc_id=%d アドオンが失敗', enc_id)
        _keep_log(f'失敗: {type(e).__name__}: {e}', force=True)
        db.update_encoding(enc_id, state='encode_error',
                           error_message=f'{type(e).__name__}: {e}'[:500])
        return
    # アドオンが {'skipped': 理由} を返したら、やっていないということ。
    # 完了にすると二度と掛からない（例: 前のサーバーが残した処理がまだ
    # 走っていて、終わるのを待ちたい場合）。待ちへ戻して次の巡回に任せる。
    if isinstance(res, dict) and res.get('skipped'):
        db.update_encoding(enc_id, state='wait_encode', progress=0.0)
        logger.info('run_one_encoding: enc_id=%d アドオン %s は見送り（%s）',
                    enc_id, name, res['skipped'])
        return
    db.update_encoding(enc_id, state='encode_end', progress=1.0,
                       encode_info=json.dumps({'addon_result': res,
                                               'addon_log': list(_lines)},
                                              ensure_ascii=False,
                                              default=str)[:100000])
    logger.info('run_one_encoding: enc_id=%d アドオン %s 完了', enc_id, name)
