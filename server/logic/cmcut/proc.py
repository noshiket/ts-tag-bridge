"""子プロセスの制限（負荷・メモリ・優先度）と起動"""

import collections
import data_paths  # server/ と server/data の場所
import os
import shutil
import signal
import subprocess
import threading


def _load_aware_workers(workers, max_load, log):
    """負荷が高ければ並列数を落とす（最低1）。

    CM解析は録画登録の一部として走るので、待たせると後続まで止まる。代わりに
    使う CPU を減らして譲る。音声解析(logic.frame_sync)のように処理の切れ目で
    待つ形にしないのはそのため。
    """
    if not workers or not max_load or not hasattr(os, 'getloadavg'):
        return workers
    try:
        load = os.getloadavg()[0]
    except OSError:
        return workers
    if load <= float(max_load):
        return workers
    n = max(1, int(workers - (load - float(max_load))))
    if n != workers:
        log(f'負荷が高いので並列数を {workers} → {n} に落とします '
            f'(load {load:.1f} > {float(max_load):.1f})')
    return n


# 解析の子プロセスが取ってよいヒープの上限。
#
# メモリを食い尽くすと、カーネルは「いちばん大きいもの」を殺すとは限らず、
# 録画やエンコード、サーバー本体を巻き添えにする。実際にそれで
# サーバーごと落ちた。見張って気づいた頃には機械が swap で這っていて、
# 立て直すためのメモリも取れない。気づいてから動くのでは遅いので、
# 子プロセス側に最初から枷をはめる。
#
# 音声は読み書きとも mmap で扱い、映像も「復号しながら mvec へ畳む」ので
# （thirdparty/chapterexe_py）、尺が伸びてもヒープは増えない。
#
# 上限は完走した実測2本から決めた（どちらも最後まで通り、結果も保存済み）:
#   録画A  6.12時間 無音140個 窓977枚 → 子の山 RssAnon 473MB
#   録画B  6.64時間                   → 子の山 RssAnon 391MB
# 同じ処理が以前は anon-rss 9.7GB まで伸びてサーバーを道連れにしていた。
#
# 1.5GB にしたのは、実測の山 473MB に対して次のぶんを見込むため:
#   - 映像の束は 64枚 ×(h×w)。1920x1072 で 132MB だが 4K なら 531MB になる
#   - この枷は logoframe_py にも掛かる（実測 210MB）
#   - numba の JIT やデコーダの取り分に振れ幅がある
# 絞りすぎると今度は枷が原因で落ちる（4GB の頃に実際それで失敗した）ので、
# 実測の3倍を残す。それでも道連れにした 9.7GB には遠く届かない。
_CHILD_HEAP_LIMIT = 3 << 29        # 1.5GB
# 万一メモリが尽きた時、カーネルにまずこの子を選ばせる（0〜1000 の最大）。
_CHILD_OOM_SCORE_ADJ = 1000


def _child_limits(nice):
    """子プロセスに優先度と枷をかける。対応していない OS では何もしない。

    - CPU: nice
    - ヒープ: RLIMIT_DATA。超えたら MemoryError で**その子だけ**死ぬ。
      mmap したファイルは RLIMIT_DATA に数えられないので、音声の読み方は
      妨げない。RLIMIT_AS だと mmap ぶんまで数えてしまうので使えない。
    - OOM: oom_score_adj を最大にして、殺すならこの子から選ばせる
    """
    if not hasattr(os, 'nice'):                 # Windows
        flag = getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', None)
        return {'creationflags': flag} if (flag and nice) else {}

    def setup():
        if nice:
            os.nice(int(nice))
        try:
            import resource
            soft, hard = resource.getrlimit(resource.RLIMIT_DATA)
            lim = _CHILD_HEAP_LIMIT if hard in (resource.RLIM_INFINITY, -1) \
                else min(_CHILD_HEAP_LIMIT, hard)
            resource.setrlimit(resource.RLIMIT_DATA, (lim, hard))
        except Exception:
            pass                                 # かけられなくても走らせる
        try:
            with open('/proc/self/oom_score_adj', 'w') as f:
                f.write(str(_CHILD_OOM_SCORE_ADJ))
        except OSError:
            pass

    return {'preexec_fn': setup}


def _nice_kwargs(nice):
    """子プロセスの優先度を下げる Popen 引数。対応していない OS では何もしない。"""
    return _child_limits(nice)


def _low_io(cmd):
    """ディスクI/O の優先度を下げる ionice を前に付ける。無ければそのまま。

    CM解析は数GBのTSを頭から読むので、録画と同じディスクだと書き込みと競合して
    ドロップを起こす。CPU は nice で下げていたが I/O は素のままだった。

    実測: 21:30〜21:45 と 22:15〜22:49 の解析中に、ある録画で
    それぞれ 18611 / 12163 パケットのロスが出た。BS と CS の別チューナーで
    同時刻に誤りが出ており（20:16:19 に BS98 と映画ch の両方）、
    受信ではなくシステム側の競合であることがはっきりしている。
    """
    return (['ionice', '-c', '3'] + cmd) if shutil.which('ionice') else cmd


def _thirdparty_env(server_dir):
    """thirdparty/ を import 先に足した環境変数を返す。

    CM 解析の3つ（logoframe_py / chapterexe_py / joinlogoscp_py）は別リポジトリとして公開しており、
    本体には同梱せず thirdparty/ へ入れる（thirdparty/install.sh）。
    """
    env = dict(os.environ)
    tp = os.path.join(server_dir, 'thirdparty')
    env['PYTHONPATH'] = tp + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
    return env


def _thirdparty_module(name):
    """thirdparty/ に入れたパッケージを、この処理の中で読み込む。
    join_logo_scp は結果をそのまま受け取るので別プロセスにしない（元からそうだった）。"""
    import importlib
    import sys
    tp = os.path.join(data_paths.SERVER_DIR, 'thirdparty')
    if tp not in sys.path:
        sys.path.insert(0, tp)
    return importlib.import_module(name)


class Aborted(RuntimeError):
    """解析を途中で止めた（録画が消された・解析中止）。"""


def _run_module(mod, args, log, nice=0, abort=None):
    """解析モジュールを別プロセスで走らせ、進捗ログを中継する。

    別プロセスにするのは numba の JIT とデコードでメモリを持つため。
    終わればまとめて解放される。

    logoframe_py / chapterexe_py は本体に同梱せず、thirdparty/ へ別途入れる
    （thirdparty/install.sh）。ここから見えるよう PYTHONPATH に足す。
    起動が別プロセスなのは元々そうだったので、扱いは変わらない。

    nice を渡すと優先度を下げる。録画登録スキャンから走らせるときに使う。

    abort を渡すと2秒ごとに尋ね、真なら子プロセスを（並列の子ごと）止めて Aborted を投げる。
    1工程が数分・4コアを使い切るので、録画を消した後まで走らせない。
    """
    import sys

    # このファイルは server/logic/cmcut.py なので2つ上が server/
    server_dir = data_paths.SERVER_DIR
    p = subprocess.Popen(_low_io([sys.executable, '-m', mod, *args]), cwd=server_dir,
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                         env=_thirdparty_env(server_dir),
                         # 止める時に並列の子もまとめて止められるよう、別の組にする
                         start_new_session=abort is not None,
                         **_nice_kwargs(nice))
    stop = threading.Event()
    killed = []
    if abort is not None:
        def _watch():
            while not stop.wait(2):
                try:
                    if not abort():
                        continue
                except Exception:
                    continue
                killed.append(True)
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    pass
                return
        threading.Thread(target=_watch, daemon=True).start()
    # 終わりの数行は失敗の理由に入れる。録画登録スキャンは log を捨てるので、
    # 「上のログを見てください」だけでは理由がどこにも残らなかった
    # （thirdparty の import 切れで全録画の CM解析が落ちていたのに cm_error から辿れなかった）
    tail = collections.deque(maxlen=5)
    try:
        for ln in p.stderr:
            ln = ln.rstrip()
            if ln:
                log(f'  {ln}')
                tail.append(ln)
        rc = p.wait()
    finally:
        stop.set()
    if killed:
        raise Aborted(f'{mod} を途中で止めました')
    if rc != 0:
        detail = ' / '.join(tail)
        raise RuntimeError(f'{mod} が失敗しました: {detail}' if detail else f'{mod} が失敗しました（上のログを見てください）')
