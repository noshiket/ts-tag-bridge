"""パターンの番号を引く（パターンと AND 条件で確かめる）"""

from quart import abort


def _find_analyzer_index(p, pattern: str, pattern2: str = ''):
    """pattern(+pattern2)に一致するanalyzerのindexを返す。無ければNone。
    配列indexはノード間で一致しない(優先度順ソートのため)ため、federation同期は
    このキーで対象を探す。"""
    for i, a in enumerate(p.analyzers):
        if a.get('pattern', '') == pattern and a.get('pattern2', '') == pattern2:
            return i
    return None


def _resolve_index(p, index: int, pattern: str, pattern2=None, exact_p2: bool = False) -> int:
    """編集・削除で渡された index が、渡された pattern の物を指しているか確かめて、その位置を返す。

    index は画面が読んだ時点の一覧の番号。その後に追加・同期・並び直しでファイルが変わると番号がずれ、
    別のパターンを上書き・削除してしまう（別のサーバーの SID1056 で「ニュースの窓 {$1} #{$2}」が
    別のパターンで上書きされて消えた。同じパターンの重複もこれで出来ていた）。

    pattern2（AND条件）の有る物と無い物は、pattern が同じでも別のパターンとして扱う。
    exact_p2=False（編集）: pattern2 の中身は書き換わることがあるので、有り無しだけを合わせる
      （有り無しが変わる保存は、画面が別のパターンとして追加する）。同じ物が複数ある時は中身で絞る。
    exact_p2=True（削除）: pattern2 の中身まで合わせる。pattern2=None は確かめない（古い呼び出し）。
    決められない時は 409 で止める。
    """
    def same(a):
        if a.get('pattern', '') != pattern:
            return False
        if pattern2 is None:
            return True
        if exact_p2:
            return a.get('pattern2', '') == pattern2
        return bool(a.get('pattern2')) == bool(pattern2)

    if 0 <= index < len(p.analyzers) and same(p.analyzers[index]):
        return index
    hits = [i for i, a in enumerate(p.analyzers) if same(a)]
    if not hits:
        abort(404, description='パターンが見つかりません')
    if len(hits) > 1 and pattern2 is not None and not exact_p2:
        hits = [i for i in hits if p.analyzers[i].get('pattern2', '') == pattern2]
    if len(hits) == 1:
        return hits[0]
    abort(409, description='パターンの一覧が古くなっています。読み直してからもう一度保存してください')
