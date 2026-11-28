"""コマンドラインの入口"""

import os
import sys
import argparse
from typing import List
from .segment import Segment, load_segments_from_json
from .split import split_ts


# =============================================================================
# CLI エントリーポイント
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='TSファイルをPCRベースで分割する',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument('input', help='入力TSファイルパス')
    parser.add_argument('-o', '--output-dir', default='',
                        help='出力先ディレクトリ（省略時は入力と同じ場所）')
    parser.add_argument('-q', '--quiet', action='store_true',
                        help='進捗出力を抑制する')

    # 単一カット用
    single_group = parser.add_argument_group('単一カット')
    single_group.add_argument('--start', type=float,
                              help='開始時刻（秒）')
    single_group.add_argument('--end', type=float,
                              help='終了時刻（秒）')
    single_group.add_argument('--output', default='',
                              help='出力ファイル名（単一カット時）')

    # 複数カット用
    multi_group = parser.add_argument_group('セグメントJSONから複数カット')
    multi_group.add_argument('--segments',
                             help='セグメント定義JSONファイルパス')

    args = parser.parse_args()

    # セグメント構築
    segments: List[Segment] = []

    if args.segments:
        try:
            segments = load_segments_from_json(args.segments)
            if not args.quiet:
                print(f"{len(segments)}件のセグメントを読み込みました")
        except Exception as e:
            print(f"エラー: セグメントJSON読み込み失敗: {e}", file=sys.stderr)
            sys.exit(1)
    elif args.start is not None and args.end is not None:
        out_name = args.output or os.path.splitext(
            os.path.basename(args.input))[0] + f'_{args.start:.0f}-{args.end:.0f}.ts'
        segments = [Segment(
            start_time=args.start,
            end_time=args.end,
            output_filename=out_name
        )]
    else:
        parser.print_help()
        sys.exit(1)

    # 分割実行
    success, message, output_files = split_ts(
        ts_path=args.input,
        segments=segments,
        output_dir=args.output_dir,
        verbose=not args.quiet
    )

    if not args.quiet:
        print(f"\n{'完了' if success else 'エラー'}: {message}")

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
