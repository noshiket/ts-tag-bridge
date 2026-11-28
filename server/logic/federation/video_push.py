"""video を federation.library_peer(master) へサーバー間で直接転送する共通処理。

tag.json の encode_dir='master'（videos.encode_dir にも即時反映される）を
「masterへ移動予約」の永続マークとして扱う。転送は relocate API（クライアント操作の
即時実行）と VideoPushWorker（バックグラウンドの自動転送・リトライ）の両方から
この push_video_to_master() を呼ぶ。二重転送は _busy セットで防ぐ。
"""

import os
import json
import logging
import threading

logger = logging.getLogger(__name__)

# 転送中の video_id（relocate API とワーカーの二重転送防止。プロセス内共有）
_busy_lock = threading.Lock()
_busy = set()


def try_begin(video_id: int) -> bool:
    """転送を開始してよければ True（呼び出し側は finally で end() すること）。"""
    with _busy_lock:
        if video_id in _busy:
            return False
        _busy.add(video_id)
        return True


def end(video_id: int) -> None:
    with _busy_lock:
        _busy.discard(video_id)


def push_video_to_master(db, config, video_id: int, captures_dir: str) -> dict:
    """video 1本を master(library_peer) へ push し、成功したらローカルの
    video 行・実ファイル・転送済みキャプチャを削除する（「移動」扱い）。

    戻り値: {'relocated': bool, 'error': str|None, 'remote_video_id': int|None,
             'status': HTTPステータス相当(200/400/409/502)}
    呼び出し側で try_begin()/end() による二重転送ガードを行うこと。
    """
    fed = config.get('federation') or {}
    if not (fed.get('library_peer') or {}).get('url'):
        return {'relocated': False, 'status': 400,
                'error': 'federation.library_peer が未設定のため master へ送信できません'}

    v = db.get_video_row(video_id)
    if v is None or not v.get('file_path'):
        return {'relocated': False, 'status': 404, 'error': '動画が見つかりません'}
    tag_path = v['file_path'] + '.tag.json'
    try:
        with open(tag_path, encoding='utf-8') as f:
            tag = json.load(f)
    except Exception:
        return {'relocated': False, 'status': 404, 'error': 'tag.json が見つかりません'}

    old_path = v.get('file_path')
    if not (old_path and os.path.exists(old_path)):
        return {'relocated': False, 'status': 409, 'error': '元ファイルが存在しません'}
    old_stem = os.path.splitext(old_path)[0]

    # push用tag: app_output_path/サムネを現在の実ファイルへ向けた一時ファイルを作る
    # (_try_push_master_direct と同じ流儀。成功するまで元の tag.json は書き換えない)
    push_tag = dict(tag)
    push_tag['app_output_path'] = old_path
    for tkey, suf in (('thumbnail_path', '.thumbnail.webp'),
                      ('thumbnail_tile_path', '.thumbnail_tile.webp')):
        s = old_stem + suf
        if os.path.exists(s):
            push_tag[tkey] = s
        else:
            push_tag.pop(tkey, None)
    push_tag_path = tag_path + '.push_tmp.json'
    # この動画に紐づくキャプチャも一緒に移動する（captures.path はファイル名のみ）
    try:
        caps = db.get_captures(video_id)
    except Exception:
        caps = []
    try:
        with open(push_tag_path, 'w', encoding='utf-8') as f:
            json.dump(push_tag, f, ensure_ascii=False, default=str)
        from clients.fed_client import FedClient
        remote_id = FedClient(fed).push_video(push_tag_path, captures=caps,
                                              capture_dir=captures_dir)
    except Exception as e:
        # 失敗時は何も消さない（tag.json の encode_dir='master' が残るため再試行可能）
        logger.warning('push_video_to_master: video_id=%d master への送信に失敗: %s',
                       video_id, e)
        return {'relocated': False, 'status': 502,
                'error': f'master への送信に失敗しました: {e}'}
    finally:
        try:
            os.remove(push_tag_path)
        except OSError:
            pass

    # 成功: ローカルの video 行とファイル・転送済みキャプチャを削除
    # （run_file_copy の push 後掃除と同じ「移動」扱い）
    db.delete_video(video_id)
    for c in caps:
        cp = os.path.join(captures_dir, os.path.basename(str(c.get('path') or '')))
        try:
            if os.path.exists(cp):
                os.remove(cp)
        except OSError:
            pass
        try:
            db.delete_capture(c['id'])
        except Exception as e:
            logger.warning('キャプチャ %s の行の削除に失敗: %s', c.get('id'), e)
    for f2 in (old_path, tag_path,
               old_stem + '.thumbnail.webp', old_stem + '.thumbnail_tile.webp'):
        if f2 and os.path.exists(f2):
            try:
                os.remove(f2)
            except OSError:
                pass
    folder = os.path.dirname(old_path)
    try:
        if folder and not os.listdir(folder):
            os.rmdir(folder)
    except OSError:
        pass
    logger.info('push_video_to_master: video_id=%d を master へ移動しました (remote_id=%s)',
                video_id, remote_id)
    return {'relocated': True, 'status': 200, 'error': None, 'remote_video_id': remote_id}
