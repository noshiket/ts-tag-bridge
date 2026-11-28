"""Amatsukaze のキューの終わりを待つ（進み具合・失敗した物を外す）"""

import time
from typing import Optional
from ..common import logger
from ..base.states import _CONSOLE_PROGRESS_RE, _DONE_STATES
from .amt_dir import get_amt_dir
from .queue import amz_failure_reason, remove_amt_dir


def _parse_console_progress(lines: list) -> Optional[float]:
    """コンソール出力行から [XX.X%] 形式の進捗を 0.0〜1.0 で返す。"""
    for line in reversed(lines):
        text = line.get('text', '') if isinstance(line, dict) else str(line)
        m = _CONSOLE_PROGRESS_RE.search(text)
        if m:
            return float(m.group(1)) / 100.0
    return None


def amatsukaze_poll_complete(
    client,
    item_id: int,
    poll_interval: int = 30,
    stop_event=None,
    on_progress=None,
    should_abort=None,
    amz_volumes: Optional[list] = None,
) -> dict:
    """Amatsukaze キューアイテムの完了をポーリングして完了アイテムを返す。

    Args:
        on_progress: callback(progress_0_1: float) — ポーリング毎に呼ばれる

    Amatsukaze がクラッシュ/再起動/到達不能になっても無限待機しないよう、
    連続接続失敗・キューからの item 消失に上限を設け、超過時は RuntimeError で
    エラー化する（呼び出し側で encode_error に回収される）。
    """
    error_count = 0      # 連続 get_queue 失敗回数
    missing_count = 0    # item が連続でキューに見つからない回数
    MAX_ERRORS = 10      # ≈5分(@30s) 連続失敗で Amatsukaze 異常とみなす
    MAX_MISSING = 10     # ≈5分 連続で item 消失 → ジョブロストとみなす

    while True:
        if stop_event and stop_event.is_set():
            raise InterruptedError('amatsukaze_poll_complete: stop requested')
        # encoding 行が DB から削除された等で中断要求があれば即抜ける
        # （ワーカーを長時間ブロックして他キューを止めないため）
        if should_abort and should_abort():
            raise InterruptedError(f'amatsukaze_poll_complete: 中断要求 (item_id={item_id})')

        try:
            queue = client.get_queue()
            items = queue.get('items', []) if isinstance(queue, dict) else []
            error_count = 0  # 取得成功

            found = False
            for item in items:
                if item.get('id') == item_id:
                    found = True
                    state = item.get('state', '').lower()
                    # ロゴ未登録だと LogoPending のまま永久に進まない。エラー化して
                    # ロゴ解析リンクを提示し、登録後に retry できるようにする。
                    if state == 'logopending':
                        logo_url = f'{client.base_url}/logo-analyze?queueItemId={item_id}'
                        raise RuntimeError(
                            f'Amatsukaze ロゴ未登録のため LogoPending: item_id={item_id} / '
                            f'ロゴ解析: {logo_url}'
                        )
                    if state in _DONE_STATES:
                        if state != 'complete':
                            # state だけだと何が起きたか分からないので、Amatsukaze 側の
                            # エラーコメント(stateDetailText + ログの [error] 行)を添える
                            reason = amz_failure_reason(client, item)
                            # 失敗した作業フォルダは誰も使わないのに残り続ける
                            # (実測: 5件で 9.2GB、最古は7日前)。理由はログから取り終えて
                            # いるし、ログ自体は Amatsukaze 側に残るので消してよい。
                            # リトライ時は purge_amz_item_for_retry が作り直す前提。
                            # 消すのは作業フォルダだけで、Amatsukaze のキューアイテムは
                            # Failed のまま残す(削除するのはアプリ側のキューを削除
                            # (run_delete)またはリトライしたときだけ)。
                            if amz_volumes is not None:
                                try:
                                    remove_amt_dir(get_amt_dir(client, item, amz_volumes))
                                except Exception as e:
                                    logger.warning(
                                        'amatsukaze_poll_complete: amt_dir 削除に失敗: %s', e)
                            raise RuntimeError(
                                f'Amatsukaze encoding failed: item_id={item_id} state={state}'
                                + (f' — {reason}' if reason else '')
                            )
                        logger.debug('amatsukaze_poll_complete: item_id=%d complete', item_id)
                        return item
                    # コンソール出力からエンコード進捗を取得
                    if on_progress:
                        try:
                            console = client.get_console(task_id=item_id)
                            lines = console.get('lines', [])
                            prog = _parse_console_progress(lines)
                            if prog is not None:
                                on_progress(prog)
                        except Exception:
                            pass
                    break

            if found:
                missing_count = 0
            else:
                missing_count += 1
                logger.warning('amatsukaze_poll_complete: item_id=%d がキューに無い (%d/%d)',
                               item_id, missing_count, MAX_MISSING)
                if missing_count >= MAX_MISSING:
                    raise RuntimeError(
                        f'Amatsukaze キューから item_id={item_id} が消失（{missing_count}回連続）。'
                        f'Amatsukaze 再起動等でジョブがロストした可能性'
                    )
        except (RuntimeError, InterruptedError):
            raise
        except Exception as e:
            error_count += 1
            logger.warning('amatsukaze_poll_complete: get_queue 失敗 (%d/%d): %s',
                           error_count, MAX_ERRORS, e)
            if error_count >= MAX_ERRORS:
                raise RuntimeError(
                    f'Amatsukaze に {error_count} 回連続で接続失敗（item_id={item_id}）: {e}'
                )

        if stop_event:
            stop_event.wait(poll_interval)
        else:
            time.sleep(poll_interval)


def _drop_failed_amz_item(client, item: dict, amz_vols: list) -> None:
    """失敗のまま残っている Amatsukaze の item を、作業フォルダごと捨てる。

    残したまま再利用すると、ポーリングがその場で失敗を見て毎回同じエラーになる。
    掃除に失敗しても続行する（新しい item を入れれば先へ進めるため）。
    """
    item_id = item.get('id')
    if item_id is None:
        return
    try:
        if amz_vols is not None:
            remove_amt_dir(get_amt_dir(client, item, amz_vols))
    except Exception as e:
        logger.warning('_drop_failed_amz_item: amt_dir 削除に失敗: %s', e)
    for change_type in ('Cancel', 'RemoveItem'):
        try:
            client.change_queue(item_id, change_type)
        except Exception as e:
            logger.info('_drop_failed_amz_item: %s item_id=%s: %s', change_type, item_id, e)
