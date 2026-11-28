"""題名と話数からの情報"""

import json
import unicodedata
from typing import Dict, List, Any, Optional, Union


class _ByTitleMixin:
    """ShoboiInfoFetcher の一部（題名と話数からの情報）。"""

    def get_info_from_title_and_episode(
        self,
        title: str,
        episode: Union[str, int],
        fetch_wiki: bool = False,
        program=None,
    ) -> Optional[Dict[str, Any]]:
        """
        タイトルと話数からしょぼいカレンダーの情報を取得する

        Args:
            title: 番組タイトル（完全一致・正規化一致で一意に絞る）
            episode: 話数（整数 or 整数文字列）
            fetch_wiki: True の場合、Wikipedia 情報も取得する
            program: (SID, 放送開始)。作品名の検索が規制で断られた時は、手元の番組表に
                     あるこの番組の作品(TID)を使う（作品名が合う時だけ）

        Returns:
            以下のキーを持つ辞書。取得失敗・複数マッチ時は None。
            {
                't-title':        str,
                't-short_title':  str,
                't-furigana':     str,
                't-tid':          str,
                't-wiki_title':   str or None,
                't-episode_name': str,
            }
        """
        def _normalize(text: str) -> str:
            if not text:
                return ''
            text = unicodedata.normalize('NFKC', text)
            text = ''.join([chr(ord(c) - 96) if 'ァ' <= c <= 'ン' else c for c in text])
            text = ''.join([c for c in text if not c.isspace() and c not in '・＆&～~'])
            return text.lower()

        def _to_ep_num(val) -> Optional[int]:
            try:
                s = str(val)
                return int(s) if s.isdigit() else None
            except (ValueError, TypeError):
                return None

        # episode をリスト or 単数値に正規化
        if isinstance(episode, list):
            # 各要素を保持（小数や非数値は None）。episode_name の整列維持に使う
            ep_nums_raw: List[Optional[int]] = [_to_ep_num(e) for e in episode]
            ep_nums: List[int] = [n for n in ep_nums_raw if n is not None]
            ep_num_for_disambig = ep_nums[0] if ep_nums else None
            is_list = True
        else:
            single = _to_ep_num(episode)
            ep_nums = [single] if single is not None else []
            ep_num_for_disambig = single
            is_list = False

        title_norm = _normalize(title)

        # 前に作品名で検索した候補を覚えていれば、検索を飛ばしてその中から選ぶ（_pick_candidate）。
        # 選んだ作品にその話数がまだ無い時、検索し直すのは前回の検索から1日たってから。
        # 放送中は話数の登録が放送に追いつかないのが普通で、そのたびに検索し直すと無駄になる。
        # 1日たてば、続編が別の作品(新しい TID)として登録された場合も拾える
        from .. import shoboi_api as _sa
        import time as _time
        remembered = _sa.remembered_title(title)
        if remembered:
            cands = [dict(c) for c in remembered.get('candidates') or []] or [
                {**{k: remembered.get(k, '') for k in ('tid', 'title', 'short_title', 'title_yomi')}, 'score': 4}]
            searched_at = remembered.get('searched_at') or 0.0
        else:
            try:
                cands = self._search_title(title, title_norm, _normalize)
            except _sa.SyobocalRateLimitError:
                cands = self._program_candidates(program, title, title_norm, _normalize)
                if not cands:
                    raise
                _sa.limit_handled()
                # 検索の結果ではないので覚えない（規制が明けたら検索し、候補を覚える）
                matched = self._pick_candidate(cands, ep_num_for_disambig)
                if matched is None:
                    return None
                print(f"[getFromTitleAndEpisode] 作品名の検索が規制中のため、番組表の作品で答えます: "
                      f"{title!r} → TID {matched.get('tid')}")
                return self._title_episode_info(matched, ep_nums, ep_nums_raw if is_list else None, is_list)
            if cands is None:
                return None
            searched_at = _time.time()
        before = json.dumps(cands, sort_keys=True, ensure_ascii=False)
        matched = self._pick_candidate(cands, ep_num_for_disambig)
        if (remembered and ep_num_for_disambig is not None
                and _time.time() - searched_at >= 86400
                and (matched is None or not self._has_episode(matched, ep_num_for_disambig))):
            print(f"[getFromTitleAndEpisode] 第{ep_num_for_disambig}話の作品が覚えた候補に無く、"
                  f"前の検索から1日たったので検索し直します: {title!r}")
            cands = self._search_title(title, title_norm, _normalize)
            if cands is None:
                return None
            searched_at = _time.time()
            matched = self._pick_candidate(cands, ep_num_for_disambig)
        if not remembered or json.dumps(cands, sort_keys=True, ensure_ascii=False) != before:
            _sa.remember_title(title, {'candidates': [c for c in cands if c.get('tid')]}, searched_at)
        if matched is None:
            return None
        return self._title_episode_info(matched, ep_nums, ep_nums_raw if is_list else None, is_list)

    def _first_episode(self, cand) -> Optional[int]:
        """その作品の最初の話数（副題が1件も無ければ None）。作品ごとに変わらないので覚えて使う。"""
        if 'first_ep' not in cand:
            subs = self.finder.get_all_subtitles(cand.get('tid', ''))
            nums = [int(e['count']) for e in subs if str(e.get('count', '')).isdigit()]
            cand['first_ep'] = min(nums) if nums else None
        return cand['first_ep']

    def _pick_candidate(self, cands, ep_num):
        """候補から1作品を選ぶ。決まらなければ None。

        話数がある時は、最初の話数が指定の話数以下で一番近い作品を選ぶ（第1期 1話〜・第2期
        13話〜 なら 15話は第2期）。最初の話数が同じなら作品名の一致の度合いが高い方。
        話数で選べない時（話数の指定が無い・まだどれにも登録が無い）は一致の度合いが一番の作品。
        各作品の副題一覧は放送のたびに増えるので覚えず、最初の話数だけ覚える（cands に書き足す）。
        一致の度合いが前方一致以上の候補があれば、部分一致の候補は見ない。
        """
        if not cands:
            return None

        def _best(pool):
            top = max(c.get('score', 0) for c in pool)
            tops = [c for c in pool if c.get('score', 0) == top]
            if len(tops) > 1:
                print(f"[getFromTitleAndEpisode] 複数マッチのためエラー: ep{ep_num} → {[c.get('title') for c in tops]}")
                return None
            return tops[0]

        if ep_num is None or len(cands) == 1:
            return _best(cands)
        pool = [c for c in cands if c.get('score', 0) >= 2] or cands
        eligible = [c for c in pool if (self._first_episode(c) is not None and c['first_ep'] <= ep_num)]
        if not eligible:
            return _best(cands)
        nearest = max(c['first_ep'] for c in eligible)
        return _best([c for c in eligible if c['first_ep'] == nearest])

    def _search_title(self, title, title_norm, _normalize):
        """作品名でしょぼいカレンダーを検索し、候補（TID・作品名・略称・読み・一致の度合い）を返す。

        一致する作品が無ければ None。
        """
        candidates = self.finder.search_title_by_keyword(title)
        scored = self._score_candidates(candidates, title, title_norm, _normalize)
        if not scored:
            print(f"[getFromTitleAndEpisode] タイトル未ヒット: {title!r}")
            return None
        return scored

    def _program_candidates(self, program, title, title_norm, _normalize):
        """その局・時刻の番組の作品を候補にする（作品名が合わなければ None）。

        番組表と作品情報は手元にあれば問い合わせない。無ければ問い合わせになり、規制中なら断られる。
        """
        sid, start_time = program or (None, None)
        try:
            ch = self.finder.get_chid(sid=int(sid)) if sid else None
        except (TypeError, ValueError):
            ch = None
        if not ch or not start_time:
            return None
        try:
            prog = self.finder.search_program(ch, str(start_time))
            tid = (prog or {}).get('tid')
            info = self.finder.get_title_info(tid) if tid else None
        except Exception:
            return None
        if not info:
            return None
        return self._score_candidates([info], title, title_norm, _normalize) or None

    @staticmethod
    def _score_candidates(candidates, title, title_norm, _normalize):
        """候補に作品名との一致の度合い(score)を付け、一致しないものは除く。"""
        # マッチ品質スコア: 完全一致(4) > 正規化完全一致(3) > 前方一致(2) > 部分一致(1)
        def _match_score(c) -> int:
            t = c.get('title', '')
            s = c.get('short_title', '')
            tn = _normalize(t)
            sn = _normalize(s)
            if t == title or s == title:
                return 4
            if tn == title_norm or sn == title_norm:
                return 3
            if (t.startswith(title) or s.startswith(title)
                    or tn.startswith(title_norm) or sn.startswith(title_norm)):
                return 2
            if title in t or title in s or title_norm in tn or title_norm in sn:
                return 1
            return 0

        scored = [{**{k: c.get(k, '') for k in ('tid', 'title', 'short_title', 'title_yomi')},
                   'score': _match_score(c)} for c in candidates]
        return [c for c in scored if c['score'] > 0]

    def _title_episode_info(self, matched, ep_nums, ep_nums_raw, is_list):
        tid = matched.get('tid', '')

        # 話数 → エピソード名（リスト対応）
        episode_name: Union[str, List[str]] = [] if is_list else ''
        try:
            if ep_nums and tid:
                all_subtitles = self.finder.get_all_subtitles(tid)
                subtitle_map = {int(e['count']): e['subtitle']
                                for e in all_subtitles if e['count'].isdigit()}
                episode_name = ([subtitle_map.get(n, '') if n is not None else '' for n in ep_nums_raw]
                                if is_list else subtitle_map.get(ep_nums[0], ''))
        except Exception as e:
            print(f"[getFromTitleAndEpisode] エピソード名取得エラー: {e}")

        # 末尾の種別表記((アニメ)/(TV)/(漫画))はタイトル/略称からも除去する
        short_title = self._strip_wiki_title_suffix(matched.get('short_title') or matched.get('title', ''))

        info: Dict[str, Any] = {
            't-title':        self._strip_wiki_title_suffix(matched.get('title', '')),
            't-short_title':  short_title,
            't-furigana':     matched.get('title_yomi', ''),
            't-tid':          tid,
            't-shoboi_tid':   tid,
            't-shoboi_url':   f'https://cal.syoboi.jp/tid/{tid}' if tid else '',
            't-wiki_title':   None,
            't-wiki_url':     None,
            't-episode_name': episode_name,
        }

        if tid:
            # Keywords 由来の wiki を getFromSid と同じロジックで解決(表記を揃える)。
            # HTTP は get_title_info(tidキャッシュ)1回のみ。wiki_url を出力へ自動付与するため常に解決。
            title_info = self.finder.get_title_info(tid) or {}
            wt, wu = self._resolve_wiki(title_info, matched.get('title', ''))
            info['t-wiki_title'] = wt
            info['t-wiki_url'] = wu

        return info
