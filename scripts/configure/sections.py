"""config.yml の質問（エンコーダー・EDCB・Amatsukaze・置き場・しょぼいカレンダーへ伝える連絡先）。それぞれ cfg を書き換える。

fresh: config.yml が見本のまま（初めての準備）。その時は見本の値ではなく、勧める値を既定にする。
"""

import os
from urllib.parse import urlparse

import checks
import gpu
import yamlio
from ask import ask, choose, say, yes

EDCB_URL = 'http://localhost:5510'
AMATSUKAZE_URL = 'http://localhost:32769'
TMP_BASE = os.path.expanduser('~/tstag-tmp')
SHOBOI_CONTACT = 'https://github.com/noshiket/ts-tag-bridge'


def encoder(cfg, opt, fresh) -> str:
    found = gpu.detect()
    say('■ エンコーダー（配信の変換・エンコードのアドオンが使う）')
    say('  見つかった GPU: ' + (', '.join(f'{e}（{gpu.ENCODERS[e][1]}）' for e in found) or 'なし'))
    streaming = cfg.setdefault('streaming', {})
    default = opt or (found[0] if found else 'FFmpeg') if fresh else (opt or streaming.get('encoder') or 'FFmpeg')
    enc = choose('どれを使いますか', [(k, v[1]) for k, v in gpu.ENCODERS.items()], default)
    streaming['encoder'] = enc
    if enc != 'FFmpeg' and enc not in found:
        say(f'  ※ {enc} に合う GPU が見つかっていません。変換に失敗する時は FFmpeg にしてください')
    need = gpu.missing_groups() if enc != 'FFmpeg' else []
    if need:
        say(f'  ※ GPU を使うには {"・".join(need)} のグループに入る必要があります（入れた後はログインし直す）:')
        say(f'      sudo usermod -aG {",".join(need)} $USER')
    return enc


def edcb(cfg, url_opt, fresh) -> None:
    say('■ EDCB')
    srv = cfg['edcb_servers'][0]
    url = ask('EDCB の HTTP の場所', url_opt or (EDCB_URL if fresh else srv.get('url') or EDCB_URL))
    say('  → ' + ('つながりました' if checks.http_ok(url) else 'つながりません（後で設定の画面から直せます）'))
    same_host = urlparse(url).hostname == urlparse(srv.get('url') or '').hostname
    tcp = ask('EDCB の TCP の場所（ライブ視聴に使う）',
              srv.get('tcp_url') if same_host and not fresh else checks.tcp_url_for(url))
    say('  → ' + ('つながりました' if checks.tcp_ok(tcp) else 'つながりません'))
    srv['url'], srv['tcp_url'] = url, tcp
    # 録画のパスの読み替え（EDCB を docker で動かし、別のパスに見せている時だけ要る）
    services = cfg.setdefault('services', {}) or {}
    cfg['services'] = services
    vols = (services.get('edcb') or {}).get('volumes') or []
    if yes('EDCB は録画を、この機械と同じパスで書いていますか（docker で別のパスに見せていない）', default=not vols):
        services.pop('edcb', None)
        return
    host = ask('録画の置き場（この機械から見たパス）', vols[0]['host'] if vols else '/mnt')
    target = ask('同じ場所を EDCB から見たパス', vols[0]['target'] if vols else '/mnt')
    new = [{'host': host, 'target': target}]
    if services.get('edcb') is not None:
        yamlio.set_list(services['edcb'], 'volumes', new)   # その場で直す（後ろのコメントを残す）
    else:
        services['edcb'] = {'volumes': new}


def amatsukaze(cfg, url_opt, fresh) -> None:
    say('■ Amatsukaze')
    srv = cfg['amatsukaze_servers'][0]
    url = ask('Amatsukaze の場所', url_opt or (AMATSUKAZE_URL if fresh else srv.get('url') or AMATSUKAZE_URL))
    say('  → ' + ('つながりました' if checks.http_ok(url) else 'つながりません（後で設定の画面から直せます）'))
    srv['url'] = url
    # docker の Amatsukaze は、この機械の / をコンテナの中の別の場所に見せていることが多い
    vols = srv.get('volumes') or []
    root = next((v['target'] for v in vols if str(v.get('host', '')).rstrip('/') == ''), '')
    root = ask('Amatsukaze から見た、この機械の / の場所（docker で / を見せている所。同じなら空）', root)
    yamlio.set_list(srv, 'volumes', [{'host': '/', 'target': root}] if root and root != '/' else [])


def places(cfg, tmp_opt, dirs_opt, fresh) -> None:
    say('■ 置き場')
    cur = cfg.get('tmp_base')
    tmp = _dir('作業の置き場（TS の分割・エンコードの途中。速いディスクがよい）',
               tmp_opt or (TMP_BASE if fresh or not cur else cur))
    cfg['tmp_base'] = tmp
    cur_dirs = list(cfg.get('encode_dir_list') or [])
    if dirs_opt:
        dirs = dirs_opt
    else:
        default = '' if fresh else ', '.join(cur_dirs)
        dirs = [d.strip() for d in ask('エンコードした動画の置き場（いくつでも。カンマで区切る。先頭が既定）', default).split(',') if d.strip()]
    if not dirs:
        say('  エンコードの置き場が空です。後で設定の画面から足してください')
    yamlio.set_list(cfg, 'encode_dir_list', [_dir(f'  {d}', d, asked=True) for d in dirs])


def shoboi(cfg, opt) -> None:
    """しょぼいカレンダーの bot 利用規約: 問い合わせの User-Agent に入れる連絡先（URL かメール）"""
    say('■ しょぼいカレンダーへ伝える連絡先（番組の情報を問い合わせる時の User-Agent に入れる）')
    contact = opt or ask('連絡先（URL かメールアドレス。空ならこのアプリの案内のページ）',
                         cfg.get('shoboi_contact') or SHOBOI_CONTACT)
    cfg['shoboi_contact'] = contact.strip() or SHOBOI_CONTACT


def _dir(question: str, default: str, asked: bool = False) -> str:
    path = default if asked else ask(question, default)
    path = os.path.expanduser(path)
    state = checks.dir_state(path)
    if state == 'まだありません' and yes(f'{path} はまだありません。作りますか'):
        state = checks.dir_state(path) if checks.make_dir(path) else '作れませんでした'
    say(f'  {path}: {state}')
    return path
