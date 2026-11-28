"""小さすぎると言われた TS を tsreadex で直す"""

import data_paths
import json
import os
import subprocess
from logic.storage.path_translator import container_to_host
from ..common import logger
from .poll import _drop_failed_amz_item


_TSREADEX = os.path.join(data_paths.SERVER_DIR, 'thirdparty', 'tsreadex', 'tsreadex')


def _repair_too_small_ts(db, enc: dict, encode_info: dict, client, item_id, err,
                         amz_vols: list) -> bool:
    """Amatsukaze が「映像が小さすぎます(0,0)」で登録を断った cut.ts を作り直す。直したら True。

    Amatsukaze は登録時に TS の中ほど 4MB ずつを読み、番組情報(EIT/SDT/時刻)が揃った
    時点で、映像の解像度がまだ取れていなくても読むのをやめる(TsInfo.cpp の ReadTS)。
    HEVC でデータ放送が多く映像が薄い TS（EPGStation の再エンコード版など）は、
    最初の 4MB に SPS が入らず 0x0 のまま断られる（実測）。

    `tsreadex -n <SID>` でそのサービスだけを取り出すと映像が詰まって通る。映像・音声・
    字幕・EIT・SDT・TOT はパケットのまま残り、落ちるのは Amatsukaze が出力でどのみち
    捨てるデータ放送だけ。ffmpeg で作り直すと字幕や EIT が落ちるので使わない。
    作り直すのは作業フォルダの cut.ts だけで、元の TS には触れない。1回だけ試す。
    """
    if '映像が小さすぎます' not in str(err) or encode_info.get('ts_repaired'):
        return False
    enc_id = enc['id']
    sid = enc.get('sid')
    input_app = container_to_host(encode_info.get('input_ts', ''), amz_vols)
    rec = db.get_recording(enc.get('recording_id')) if enc.get('recording_id') else None
    source = (rec or {}).get('app_ts_path') or ''
    if not sid or not input_app or not os.path.isfile(input_app):
        return False
    if source and os.path.abspath(input_app) == os.path.abspath(source):
        # 作業フォルダを使わず元の TS を直接渡している（同じドライブ）。元は書き換えない
        logger.warning('_repair_too_small_ts: enc_id=%d 入力が元の TS そのものなので直しません', enc_id)
        return False
    if not os.access(_TSREADEX, os.X_OK):
        logger.warning('_repair_too_small_ts: tsreadex がありません（thirdparty/install.sh）: %s',
                       _TSREADEX)
        return False

    tmp = input_app + '.repair'
    logger.info('_repair_too_small_ts: enc_id=%d 映像が小さすぎますで断られたので '
                'tsreadex -n %s で cut.ts を作り直します', enc_id, sid)
    with open(tmp, 'wb') as out:
        r = subprocess.run([_TSREADEX, '-n', str(int(sid)), input_app],
                           stdout=out, stderr=subprocess.PIPE)
    if r.returncode != 0 or os.path.getsize(tmp) <= 0:
        os.remove(tmp)
        raise RuntimeError(f'tsreadex で作り直せませんでした (code={r.returncode}): '
                           f'{r.stderr.decode(errors="replace")[-300:]}')
    before = os.path.getsize(input_app)
    # cut.ts は元へのリンクのことがある（trim モード）。中身へ書かずに差し替えるので元は変わらない
    os.replace(tmp, input_app)
    logger.info('_repair_too_small_ts: enc_id=%d 作り直しました (%.2fGB → %.2fGB)',
                enc_id, before / 1e9, os.path.getsize(input_app) / 1e9)

    # 断られた item は失敗のまま残る。残すと同じ srcPath の再登録で拾われる
    try:
        items = (client.get_queue() or {}).get('items', []) or []
        for it in items:
            if it.get('id') == item_id:
                _drop_failed_amz_item(client, it, amz_vols)
    except Exception as e:
        logger.warning('_repair_too_small_ts: 失敗した item の片付けに失敗（続行）: %s', e)
    encode_info['ts_repaired'] = f'tsreadex -n {int(sid)}（映像が小さすぎます(0,0) で断られたため）'
    db.update_encoding(enc_id, encode_info=json.dumps(encode_info))
    return True
