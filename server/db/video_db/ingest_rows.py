"""登録の行づくり（カテゴリ・アルバム・シリーズを足す・並び順を付ける・動画の行を入れる）"""

import re
import json
from typing import Optional
from .common import (
    _VIDEO_JSON_COLS,
    _VIDEO_TAG_COLS,
    _has_announce,
    _has_drop_or_scramble,
    caption_flag,
    comment_track_stats,
    drop_scramble_counts,
)


class _IngestRowsMixin:
    """登録の行づくり（カテゴリ・アルバム・シリーズを足す・並び順を付ける・動画の行を入れる）"""

    def _upsert_category(self, conn, name: str, now: str) -> int:
        conn.execute(
            "INSERT INTO categories(name, created_at, updated_at) VALUES(?,?,?) "
            "ON CONFLICT(name) DO NOTHING", (name, now, now))
        return conn.execute("SELECT id FROM categories WHERE name=?", (name,)).fetchone()[0]

    def _upsert_album(self, conn, name: str, now: str) -> int:
        conn.execute(
            "INSERT INTO albums(name, created_at, updated_at) VALUES(?,?,?) "
            "ON CONFLICT(name) DO NOTHING", (name, now, now))
        return conn.execute("SELECT id FROM albums WHERE name=?", (name,)).fetchone()[0]

    def _upsert_series(self, conn, album_id: Optional[int], name: str,
                       furigana: Optional[str], now: str) -> int:
        # UNIQUE(album_id, name) は NULL を区別しないため album_id=NULL は手動照合
        if album_id is None:
            row = conn.execute(
                "SELECT id FROM series WHERE album_id IS NULL AND name=?", (name,)).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM series WHERE album_id=? AND name=?", (album_id, name)).fetchone()
        if row:
            sid = row[0]
            if furigana:
                conn.execute("UPDATE series SET furigana=?, updated_at=? WHERE id=?",
                             (furigana, now, sid))
            return sid
        cur = conn.execute(
            "INSERT INTO series(album_id, name, furigana, created_at, updated_at) "
            "VALUES(?,?,?,?,?)", (album_id, name, furigana, now, now))
        sid = cur.lastrowid
        # 新規seriesは名前順の位置で既存の設定順(sort_order)へ挿入する
        self._assign_series_sort_order(conn, album_id, sid, name, now)
        return sid

    def _assign_series_sort_order(self, conn, album_id: Optional[int], series_id: int,
                                  name: str, now: str) -> None:
        """新規seriesをalbum内の名前順の位置で既存の設定順へ挿入する（既存の相対順は保つ）。"""
        if album_id is None:
            rows = conn.execute(
                "SELECT id, name FROM series WHERE album_id IS NULL ORDER BY sort_order, name, id").fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name FROM series WHERE album_id=? ORDER BY sort_order, name, id",
                (album_id,)).fetchall()
        others = [(r['id'], r['name'] or '') for r in rows if r['id'] != series_id]
        if not others:
            return
        # 「自分より名前順で前」の最後の要素の直後へ挿入する。手動で並び替え済みの
        # リストでも先頭に固定した要素を新規挿入が追い越さない(全て自分より後なら先頭)
        idx = 0
        for i, (_sid, sname) in enumerate(others):
            if sname < (name or ''):
                idx = i + 1
        ids = [sid for sid, _ in others]
        ids.insert(idx, series_id)
        for i, sid in enumerate(ids):
            conn.execute("UPDATE series SET sort_order=?, updated_at=? WHERE id=?", (i, now, sid))

    @staticmethod
    def _episode_number_key(v) -> Optional[float]:
        """episode_number文字列から先頭の数値を取り出す（'22' / '22, 23' / None 対応）。"""
        if v is None:
            return None
        m = re.search(r'\d+(?:\.\d+)?', str(v))
        return float(m.group(0)) if m else None

    def _assign_video_sort_order(self, conn, series_id: int, video_id: int,
                                 tag: dict, now: str) -> None:
        """新規videoをseries内の設定順へ挿入する。episode_number順、
        episode_numberがなければ放送日(eit_start_time/recording_start_time)順の位置に入れる。"""
        rows = conn.execute(
            "SELECT id, episode_number, eit_start_time, recording_start_time FROM videos "
            "WHERE series_id=? ORDER BY sort_order, created_at, id", (series_id,)).fetchall()
        others = [r for r in rows if r['id'] != video_id]
        if not others:
            return
        new_ep = self._episode_number_key(tag.get('episode_number'))
        new_bc = tag.get('eit_start_time') or tag.get('recording_start_time') or ''
        # 「自分より前(話数/放送日が小さいか同じ)」の最後の要素の直後へ挿入する
        # (シリーズ挿入と同じ規則。手動で先頭に動かした要素を新規挿入が追い越さない)
        idx = 0
        for i, r in enumerate(others):
            if new_ep is not None:
                ep = self._episode_number_key(r['episode_number'])
                if ep is not None and ep <= new_ep:
                    idx = i + 1
            else:
                bc = r['eit_start_time'] or r['recording_start_time'] or ''
                if bc and new_bc and bc <= new_bc:
                    idx = i + 1
        ids = [r['id'] for r in others]
        ids.insert(idx, video_id)
        for i, vid in enumerate(ids):
            conn.execute("UPDATE videos SET sort_order=?, updated_at=? WHERE id=?", (i, now, vid))

    def _insert_video(self, conn, tag: dict, file_path: str,
                      series_id: Optional[int], device: Optional[str], now: str) -> int:
        data = {
            'series_id': series_id,
            'file_path': file_path,
            'app_output_path_format': tag.get('app_output_path_format'),
            'recording_device': device,
            'created_at': now,
            'updated_at': now,
        }
        for col in _VIDEO_TAG_COLS:
            v = tag.get(col)
            if col in _VIDEO_JSON_COLS and isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False)
            elif col == 'encode_dir' and isinstance(v, list):
                # 複数話tagはencode_dirがリストのことがあるため episode_idx で単話へ縮約
                idx = tag.get('episode_idx')
                idx = idx if isinstance(idx, int) and 0 <= idx < len(v) else 0
                v = v[idx] if v else None
            data[col] = v
        # 重複録画の許可: drop/scramble または 放送異常告知(announce)がある動画は登録時に
        # 自動で許可(撮り直し歓迎=この動画に一致する予約を自動スキップしない)。
        # ★初期登録時のみ。以降はユーザーの手動トグルを尊重し自動で上書きしない。
        data['allow_duplicate'] = 1 if (_has_drop_or_scramble(data.get('drop_error'))
                                        or _has_announce(data.get('announce'))) else 0
        # drop_error から畳んだ件数を列にも持つ（重複索引が毎回 JSON 解析しないため）
        data['drop_count'], data['scramble_count'] = \
            drop_scramble_counts(data.get('drop_error'))
        # 字幕の有無も列に持つ（一覧が captions_json 本体を読まないため）
        data['has_caption'] = caption_flag(data.get('captions_json'), data.get('captions2_json'))
        # 実況コメントのトラック数と最大件数も同様
        data['added_comment_tracks'], data['max_comment_count'] = \
            comment_track_stats(data.get('comments_json'), data.get('comment_count'))
        cols = ','.join(data.keys())
        ph = ','.join('?' * len(data))
        cur = conn.execute(f"INSERT INTO videos ({cols}) VALUES ({ph})", tuple(data.values()))
        return cur.lastrowid
