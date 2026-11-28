"""パターンの追加・保存と、文脈の正規化"""

import copy
import json
import os
import re
import unicodedata
from typing import Dict, List, Any


class _ConfigMixin:
    """TextParser の一部（パターンの追加・保存と、文脈の正規化）。"""

    @staticmethod
    def _normalize_context(context: Dict[str, Any]) -> Dict[str, Any]:
        """context 内の全文字列値を NFKC 正規化・改行コード統一して返す（新規辞書）"""
        def _norm(v: str) -> str:
            v = v.replace('\r\n', '\n').replace('\r', '\n')
            v = unicodedata.normalize('NFKC', v)
            # normalize_text と同じ文字統一（NFKC では変換されない）。service_name の
            # 'KT−Z'(U+2212) → 'KT-Z' などを揃える。複数行値を壊さないよう空白圧縮/strip はしない。
            v = v.replace('〜', '~')   # 〜 wave dash → ~
            v = v.replace('−', '-')   # − MINUS SIGN → hyphen-minus
            return v
        return {
            k: _norm(v) if isinstance(v, str) else v
            for k, v in context.items()
        }

    @staticmethod
    def _normalize_brackets(text: str) -> str:
        """[字] などの放送マーク（[...] 形式）をスペースに変換する。
        先頭・末尾のスペースは除去し、連続スペースは1つに圧縮する。
        例: "タイトル[字]" → "タイトル", "[字]タイトル" → "タイトル",
            "タイトル[字]副題" → "タイトル 副題"
        """
        if not text:
            return text
        text = unicodedata.normalize('NFKC', text)
        # U+2018/2019 の曲がりクォートを ASCII apostrophe に統一
        # （パターン登録時と番組タイトル取得元で文字が異なることがある）
        text = text.replace('‘', "'").replace('’', "'")
        text = re.sub(r'\[[^\]]*\]', ' ', text)
        text = re.sub(r' +', ' ', text)
        return text.strip()

    # ------------------------------------------------------------------
    # Config 追加・保存
    # ------------------------------------------------------------------

    def add_analyzer(self, new_analyzer: Dict[str, Any]) -> str:
        """
        新しいアナライザーを追加する。
        同じ pattern が既に存在する場合は switch/list を統合する。
        追加後は self.analyzers の優先度順を維持する。
        ファイルへの書き込みは save() を呼ぶこと。

        Args:
            new_analyzer: 追加するアナライザーの辞書

        Returns:
            'added'   : 新規追加
            'merged'  : 既存パターンに統合
        """
        # pattern の [字] などを正規化してから格納する
        new_analyzer = dict(new_analyzer)
        new_analyzer['pattern'] = self._normalize_brackets(new_analyzer.get('pattern', ''))
        new_pattern = new_analyzer['pattern']

        # 同じ pattern (+ pattern2) の既存アナライザーを探す
        new_pattern2 = new_analyzer.get('pattern2', '')
        existing = next(
            (a for a in self.analyzers
             if a.get('pattern', '') == new_pattern and a.get('pattern2', '') == new_pattern2),
            None
        )

        if existing is None:
            # 優先度順の正しい位置に挿入
            priority = self._analyzer_priority(new_analyzer)
            insert_pos = next(
                (i for i, a in enumerate(self.analyzers)
                 if self._analyzer_priority(a) > priority),
                len(self.analyzers)
            )
            self.analyzers.insert(insert_pos, new_analyzer)
            result = 'added'
        else:
            self._merge_analyze_list(
                existing.setdefault('analyze', []),
                new_analyzer.get('analyze', [])
            )
            result = 'merged'

        return result

    def replace_analyzer(self, index: int, new_analyzer: Dict[str, Any]) -> int:
        """index 番目のアナライザーを置き換え、置き換えた後の位置を返す。

        優先度（_analyzer_priority）が変わった時は、追加と同じく優先度順の位置へ並び直す。
        採用は並び順で最初に当たったものなので、編集で優先度が上がっても元の位置のままだと、
        より汎用のパターンに負け続ける（別のサーバーの SID1056 の {$1}【{$3}】{$4} #{$2} が
        {$1} #{$2} の下に残っていた）。優先度が変わらない編集では位置を動かさない。
        """
        old = self.analyzers[index]
        self.analyzers[index] = new_analyzer
        if self._analyzer_priority(old) == self._analyzer_priority(new_analyzer):
            return index
        a = self.analyzers.pop(index)
        priority = self._analyzer_priority(a)
        pos = next((i for i, b in enumerate(self.analyzers) if self._analyzer_priority(b) > priority),
                   len(self.analyzers))
        self.analyzers.insert(pos, a)
        return pos

    def tidy_analyzers(self) -> Dict[str, Any]:
        """崩れた並びと重複を直す（今の採用結果をできるだけ変えずに）。

        過去に、画面の古い番号で別のパターンを上書きする不具合があり（今は直してある）、
        同じパターンの重複と、汎用のパターンが細かいパターンより上にある並びが残っていた。
          1. 重複（pattern と pattern2 の組が同じ物）を、上にある物へまとめる。今の採用は上の物なので、
             else と同じ名前の一覧は上の物を残し、上に無い一覧の名前だけ下の物から足す
             （下の物の一覧は今も当たれば使われるため、捨てない）。switch 以外の処理を持つ物など、
             まとめると動きが変わる物はまとめずに残す
          2. 優先度順（_analyzer_priority）に並べる。同じ優先度は今の順のまま。pattern2 同士も文字数・グループ数で
             並べる（番組説明と詳しい説明のように取り方が違う AND条件では、結果が悪くなる局もある: 別のサーバーの SID299 で
             全話分の副題が1話分になった。それでも登録の決まりと同じ並びにそろえる）
        戻り値: {'merged': まとめた数, 'moved': 並びが変わったか, 'before': [...], 'after': [...]}
        （before/after は pattern と pattern2 の組の並び）
        """
        def key(a):
            return (a.get('pattern', ''), a.get('pattern2', ''))

        def merge_keep_first(first, dup) -> bool:
            sw_first = [x for x in first.get('analyze', []) if 'switch' in x]
            items = dup.get('analyze', [])
            targets = []
            for item in items:
                tgt = next((x for x in sw_first if 'switch' in item and x['switch'] == item['switch']), None)
                if tgt is None:
                    return False
                targets.append((tgt, item))
            for tgt, item in targets:
                have = {e.get('str', '') for e in tgt.setdefault('list', [])}
                for e in item.get('list', []):
                    if e.get('str', '') not in have:
                        tgt['list'].append(copy.deepcopy(e))
                        have.add(e.get('str', ''))
            return True

        before = [key(a) for a in self.analyzers]
        kept: List[Dict[str, Any]] = []
        merged = 0
        for a in self.analyzers:
            same = next((m for m in kept if key(m) == key(a)), None)
            if same is not None and merge_keep_first(same, a):
                merged += 1
            else:
                kept.append(a)
        kept.sort(key=self._analyzer_priority)
        self.analyzers = kept
        after = [key(a) for a in kept]
        return {'merged': merged, 'moved': before != after, 'before': before, 'after': after}

    def _merge_analyze_list(self, existing_list: List, new_list: List) -> None:
        """
        analyze リストを統合する。
        - switch が同じ → _merge_switch_list で list エントリを統合
        - switch がない / switch が異なる → そのまま追加
        """
        for new_item in new_list:
            if 'switch' not in new_item:
                existing_list.append(new_item)
                continue

            existing_switch = next(
                (e for e in existing_list if e.get('switch') == new_item['switch']),
                None
            )
            if existing_switch is None:
                existing_list.append(new_item)
            else:
                self._merge_switch_list(existing_switch, new_item)

    def _merge_switch_list(self, existing_switch: Dict, new_switch: Dict) -> None:
        """
        switch アイテムの list エントリを統合する。
        - 同じ str → 新しい内容で上書き
        - 新しい str → 末尾に追加
        - else → 新しい内容で上書き
        """
        existing_entries = existing_switch.setdefault('list', [])
        for new_entry in new_switch.get('list', []):
            new_str = new_entry.get('str', '')
            existing_entry = next(
                (e for e in existing_entries if e.get('str', '') == new_str),
                None
            )
            if existing_entry is None:
                existing_entries.append(new_entry)
            else:
                # 同じ str → 上書き
                existing_entry.clear()
                existing_entry.update(new_entry)
        if 'else' in new_switch:
            existing_switch['else'] = new_switch['else']

    def save(self, path: str = None) -> None:
        """
        現在の設定を JSON ファイルに保存する。
        analyzers は優先度順にソートして書き込む。

        Args:
            path: 保存先パス。省略時は読み込み元の config_path に保存
        """
        target = path or self.config_path
        self._log_save_diff(target)
        self.config['analyzers'] = self.analyzers  # add_analyzer で既に優先度順
        with open(target, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)

    def _log_save_diff(self, target: str) -> None:
        """保存直前に、今ディスクにある内容と比べて何が消える/変わるかをログに出す。

        パターンの追加・編集で「他のパターンが消えた」かどうかを後から追えるようにする
        （メモリ上の analyzers をファイルへ丸ごと書き戻すため、キャッシュが古いと
        ディスク側の変更を巻き戻してしまう。それをここで検知する）。
        best-effort。ログ出力で保存を失敗させない。
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            if not os.path.exists(target):
                logger.info('text_parser save: %s 新規作成 analyzers=%d',
                            os.path.basename(target), len(self.analyzers))
                return
            with open(target, encoding='utf-8') as f:
                disk = (json.load(f) or {}).get('analyzers') or []

            def _key(a):
                return (a.get('pattern', ''), a.get('pattern2', ''))

            def _strs(a):
                """analyze 配下の switch/list の str を集める（消えた分岐を見るため）。"""
                out = []
                for item in (a.get('analyze') or []):
                    sw = item.get('switch')
                    for e in (item.get('list') or []):
                        out.append(f"{sw}={e.get('str', '')}")
                return out

            mem = {_key(a): a for a in self.analyzers}
            old = {_key(a): a for a in disk}
            gone = [k for k in old if k not in mem]
            added = [k for k in mem if k not in old]
            name = os.path.basename(target)
            if gone:
                logger.warning('text_parser save: %s パターンが消えます %d件 (%d→%d): %s',
                               name, len(gone), len(disk), len(self.analyzers),
                               [g[0] for g in gone])
            for k in mem:
                if k not in old:
                    continue
                lost = [s for s in _strs(old[k]) if s not in set(_strs(mem[k]))]
                if lost:
                    logger.warning('text_parser save: %s パターン %r の分岐が消えます: %s',
                                   name, k[0], lost)
            logger.info('text_parser save: %s analyzers %d→%d (追加%d 削除%d)',
                        name, len(disk), len(self.analyzers), len(added), len(gone))
        except Exception as e:
            logger.warning('text_parser save: 差分ログの作成に失敗: %s', e)

    def _check_auto_send(self, result: Dict[str, Any], rules: List[Dict[str, Any]]) -> bool:
        """
        rules のいずれかのエントリが result にマッチすれば True を返す。
        エントリ内の全フィールドが一致すればマッチとみなす。
        """
        return any(
            all(result.get(k) == v for k, v in rule.items())
            for rule in rules
        )
