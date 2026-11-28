"""CM 判定に使うロゴと JL（選ぶ・期間・Amatsukaze から取ってくる）"""

import os
import subprocess
from .inputs import _CONTAINER, _JL_DIR, _LOGO_DIR, _NO_LOGO


def _pick_logos(setting, width, height, when, workdir, log):
    """この録画に使う .lgd を選び、コンテナから作業ディレクトリへ取り出す。

    選び方は Amatsukaze のチャンネル設定に従う。
      enabled : 利用者が無効にしたロゴは使わない
      exists  : 実体の無い登録は飛ばす
      from/to : 有効期間。局のロゴ変更をまたぐと古い録画に新しいロゴを当ててしまう
      解像度  : 合わない .lgd は無言で「全フレームロゴなし」になり CM カットが丸ごと壊れる

    残ったものは全部渡す(LogoFrame.selectLogo が最良の1つを選ぶ)。
    """
    sid = int(setting.get('serviceId'))
    ok, ng, nologo = [], [], False
    for lg in setting.get('logos') or []:
        name = lg.get('fileName') or ''
        if not lg.get('enabled'):
            ng.append(f'{name}(無効)')
        elif name == _NO_LOGO:
            # 原典 TranscodeWorker.cs:834-836 と同じ扱い。この登録が有効なら
            # 「ロゴを使わない」局なので、ロゴ判定そのものを行わない
            nologo = True
        elif not lg.get('exists'):
            ng.append(f'{name}(実体なし)')
        elif lg.get('imageWidth') != width or lg.get('imageHeight') != height:
            ng.append(f'{name}({lg.get("imageWidth")}x{lg.get("imageHeight")})')
        elif not _in_period(lg, when):
            ng.append(f'{name}(期間外 {str(lg.get("from"))[:10]}〜{str(lg.get("to"))[:10]})')
        else:
            ok.append(name)
    if ng:
        log(f'使わないロゴ: {", ".join(ng)}')
    if not ok:
        if nologo:
            log('この局は「ロゴなし」設定です。ロゴ判定を省いて解析します')
            return []
        raise RuntimeError(
            f'SID{sid} に使えるロゴがありません（{width}x{height} / 録画時刻 '
            f'{when:%Y-%m-%d}）。除外したもの: {", ".join(ng) or "なし"}。'
            'プレイヤーの「ロゴ」タブで作るか、Amatsukaze 側の有効期間を見直してください')
    return [_fetch_logo(name, workdir) for name in ok]


def _in_period(lg, when) -> bool:
    from datetime import datetime
    try:
        a = datetime.fromisoformat(str(lg.get('from')))
        b = datetime.fromisoformat(str(lg.get('to')))
    except (TypeError, ValueError):
        return True         # 期間が読めないものは絞り込みに使わない
    return a <= when <= b


def _fetch_logo(name: str, workdir: str) -> str:
    """コンテナの /app/logo から .lgd を取り出す。

    Amatsukaze の API に .lgd をそのまま落とす口が無いので docker exec で読む。
    join_logo_scp と同じ依存なので新しい前提は増えない。
    """
    dst = os.path.join(workdir, name)
    if os.path.exists(dst):
        return dst
    r = subprocess.run(['docker', 'exec', _CONTAINER, 'cat', f'{_LOGO_DIR}/{name}'],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f'ロゴを取り出せませんでした: {name} '
                           f'({(r.stderr or b"").decode("utf-8", "replace").strip()})')
    with open(dst, 'wb') as f:
        f.write(r.stdout)
    return dst


def _fetch_jl_dir(workdir: str) -> str:
    """コンテナの /app/JL をまるごと取り出してホスト側のパスを返す。

    JL は `Call` で common/ や data/ の中を参照するので、1ファイルだけ
    取り出しても動かない。ディレクトリごと持ってくる（300KB 程度）。
    Python 実装で走らせる時だけ必要。
    """
    dst = os.path.join(workdir, 'JL')
    if os.path.isdir(dst):
        return dst
    r = subprocess.run(['docker', 'cp', f'{_CONTAINER}:{_JL_DIR}', dst],
                       capture_output=True, text=True)
    if r.returncode != 0 or not os.path.isdir(dst):
        raise RuntimeError('JL を取り出せませんでした: '
                           + (r.stderr or r.stdout).strip())
    return dst
