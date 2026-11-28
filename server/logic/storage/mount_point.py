#!/usr/bin/env python3
"""
パスに対するマウントポイントを取得するユーティリティ
Usage:
  python3 mount_point.py /path/to/check
  python3 mount_point.py /path1 /path2 /path3
"""

import os
import sys


def get_mount_point(path, reject_root=False):
    """単発パス → 親ディレクトリを辿ってマウントポイントを返す

    reject_root=True の場合、マウントポイントが / ならば
    デバイス未マウントとみなして ValueError を送出する。
    """
    path = os.path.realpath(path)
    while not os.path.ismount(path):
        path = os.path.dirname(path)
    if reject_root and path == "/":
        raise ValueError(f"マウントされたデバイスが見つかりません: {path}")
    return path


def get_mount_points(paths):
    """複数パス → /proc/mounts 1回読みで全パスのマウントポイントを返す"""
    with open("/proc/mounts") as f:
        mounts = sorted(
            [line.split()[1] for line in f],
            key=len, reverse=True,
        )
    result = {}
    for p in paths:
        real = os.path.realpath(p)
        result[p] = next(
            (m for m in mounts if real == m or real.startswith(m + "/")),
            "/",
        )
    return result


def safe_makedirs(file_path, base=None):
    """ファイルの親ディレクトリを作成する。2階層以上の作成が必要ならエラー。

    1つ上（親）が無い → 作成OK（新規フォルダ）
    2つ上（祖父母）が無い → デバイス未マウントの可能性があるため ValueError

    base を渡すと、そこが実在する（＝ディスクがマウントされている）ことを確かめた上で、
    その配下は何階層でも作る。未マウント検知は base の実在で足りるため。
    音楽は <encode_dir>/<アーティスト>/<アルバム>/ と一度に2階層増えることがあり、
    アーティスト名を直すとどちらも新規になる。
    """
    parent = os.path.dirname(os.path.realpath(file_path))
    if os.path.isdir(parent):
        return parent
    if base:
        real_base = os.path.realpath(base)
        if not os.path.isdir(real_base):
            raise ValueError(
                f"保存先が存在しません（デバイス未マウントの可能性）: {base}"
            )
        if parent != real_base and not parent.startswith(real_base + os.sep):
            raise ValueError(f"保存先の外には作れません: {parent}")
        os.makedirs(parent, exist_ok=True)
        return parent
    grandparent = os.path.dirname(parent)
    if not os.path.isdir(grandparent):
        raise ValueError(
            f"2階層以上のディレクトリが存在しません（デバイス未マウントの可能性）: {grandparent}"
        )
    os.makedirs(parent, exist_ok=True)
    return parent


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 mount_point.py <path> [path2 ...]")
        sys.exit(1)

    paths = sys.argv[1:]
    if len(paths) == 1:
        mp = get_mount_point(paths[0])
        print(f"{paths[0]} -> {mp}")
    else:
        for p, mp in get_mount_points(paths).items():
            print(f"{p} -> {mp}")


if __name__ == "__main__":
    main()
