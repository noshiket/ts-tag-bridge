"""音楽のアルバムのまとめ方（大文字小文字・ディスク・アルバムアーティストの揃え）"""

import re
import unicodedata


def _fs_fold(name: str) -> str:
    """アルバム名とフォルダ名を突き合わせるための正規化。

    出力先のディレクトリ名は text_parser がファイル名に使える形へ直してから
    作られるので、素の文字列比較だと大半が「不一致」になってしまう
    （実測: 不一致60件のうち52件がこの変換によるもの）。

      ！→!  ？→?  ：→:  ‼→!!  ⁉→!?      NFKC で吸収
      \\ / : * ? " < > |                  ファイル名に使えないので落ちている
      末尾の . と空白                      Windows/Samba が許さないので落ちている

    ここで同じになるものは「分類は合っている」とみなす。
    """
    t = unicodedata.normalize('NFKC', name or '')
    t = t.replace('\u2010', '-').replace('\u2015', '-').replace('\uff5e', '~')
    t = re.sub(r'[\\/:*?"<>|]', '', t)
    return re.sub(r'\s+', ' ', t).strip(' .')


def _music_disc_id(music_key) -> str:
    """music_key('cddb:<盤のTOC>:<トラック番号>') から盤の識別子を取り出す。"""
    k = str(music_key or '')
    return k.split(':')[1] if k.startswith('cddb:') and k.count(':') >= 2 else ''


def _same_album_artist(a: str, b: str) -> bool:
    """客演などで表記が違うだけの同じアーティストか。

    'Band' と 'Band & Guest Singer'、'歌い手' と '歌い手 with 合成音声'、
    '高橋四郎' と '高橋四郎、他' のように、片方がもう片方の頭にあるものを同一とみなす。
    取り込み時に付く '不明なアーティスト' もどれとでも束ねてよい扱いにする。
    """
    x, y = (a or '').strip().lower(), (b or '').strip().lower()
    if not x or not y or x == y:
        return True
    if '不明なアーティスト' in (x, y):
        return True
    return x.startswith(y) or y.startswith(x)


def _merge_music_albums(rows: list) -> list:
    """同じアルバムがアーティスト違いで割れているものを1枚に束ねる。

    束ねる条件はアルバム名が同じで、かつ
      ・盤(CDのTOC)が分かるもの同士なら同じ盤であること（別の盤なら別アルバムのまま）
      ・分からない場合はアーティスト表記が同系統であること（_same_album_artist）
    代表は曲数が最も多いもの。曲数・追加日などは束ねたぶんを合算する。
    series_ids に束ねた series の id を全部入れる（曲を引く時に使う）。
    """
    merged = []
    for r in sorted(rows, key=lambda x: -(x.get('track_count') or 0)):
        disc = _music_disc_id(r.get('music_key'))
        name = (r.get('name') or '').strip().lower()
        for m in merged:
            if name != (m.get('name') or '').strip().lower():
                continue
            m_disc = _music_disc_id(m.get('music_key'))
            if disc and m_disc:
                if disc != m_disc:
                    continue
            elif not _same_album_artist(r.get('artist'), m.get('artist')):
                continue
            m['series_ids'].append(r['series_id'])
            m['track_count'] = (m.get('track_count') or 0) + (r.get('track_count') or 0)
            for k in ('added_at', 'updated_at'):
                if (r.get(k) or '') > (m.get(k) or ''):
                    m[k] = r[k]
            if (r.get('year_at') or '') and (not m.get('year_at') or r['year_at'] < m['year_at']):
                m['year_at'] = r['year_at']
            break
        else:
            merged.append({**r, 'series_ids': [r['series_id']]})
    for m in merged:
        m.pop('music_key', None)
    return merged
