"""コマンドラインの入口"""

import argparse
import json
from .merge import (  # noqa: F401
    analyze,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video_a")
    parser.add_argument("video_b")
    parser.add_argument("--ffmpeg", default="ffmpeg",
                        help="ffmpeg のパス(既定: PATH 上の ffmpeg)")
    parser.add_argument("--min-match", type=int, default=10,
                        help="minimum match length (seconds)")
    parser.add_argument("--output")
    parser.add_argument("--correlation", type=float, default=0.75,
                        help="correlation threshold (default: 0.75, range: 0.0-1.0)")
    parser.add_argument("--bridge", action="store_true",
                        help="時間ずれが同じ連続マッチを、間の未検出区間ごと繋げる")
    parser.add_argument("--bridge-tol", type=float, default=1.0,
                        help="--bridge で同一とみなすずれの許容差(秒、default: 1.0)")
    parser.add_argument("--max-dist", type=float, default=2.0,
                        help="マッチ伸長を打ち切る特徴量距離のしきい値 (default: 2.0)。"
                             "別局同士など音の作りが違う素材では上げると繋がりやすい")
    parser.add_argument("--resolution", type=int, default=500,
                        help="initial detection resolution in ms (default: 500ms)")
    parser.add_argument("--two-stage", action="store_true",
                        help="enable two-stage detection")
    parser.add_argument("--first-min-match", type=int, default=80,
                        help="minimum match length for first stage (seconds)")
    parser.add_argument("--refine", action="store_true",
                        help="enable multi-resolution refinement after initial detection")
    parser.add_argument("--refine-resolutions", type=int, nargs="+",
                        default=[250, 125],
                        help="resolution stages for refinement in ms (default: 250 125)")
    parser.add_argument("--refine-margin-frames", type=int, default=5,
                        help="boundary search width in frames per stage (default: 5). "
                             "actual margin(sec) = resolution_ms/1000 * margin_frames")
    parser.add_argument("--merge-equal-gaps", action="store_true",
                        help="merge consecutive matches when gap_from_prev is identical for videoA and videoB")
    args = parser.parse_args()

    matches = analyze(
        args.video_a, args.video_b, ffmpeg=args.ffmpeg,
        min_match=args.min_match, correlation=args.correlation,
        resolution=args.resolution, max_dist=args.max_dist, two_stage=args.two_stage,
        first_min_match=args.first_min_match, refine=args.refine,
        refine_resolutions=args.refine_resolutions,
        refine_margin_frames=args.refine_margin_frames,
        merge_equal_gaps=args.merge_equal_gaps,
        bridge=args.bridge, bridge_tol=args.bridge_tol,
        on_log=print,
    )

    if args.output:
        with open(args.output, "w") as f:
            json.dump(matches, f, indent=2)
        print(f"Results saved to: {args.output}")
    else:
        print(json.dumps(matches, indent=2))


if __name__ == "__main__":
    main()
