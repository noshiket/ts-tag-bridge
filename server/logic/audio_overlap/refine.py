"""見つけた一致の境目と位置を細かく合わせる"""

import numpy as np
from .mfcc import _compute_features
from .features import format_time, parse_time


# ============================
# 境界の精緻化（1点）
# ============================
def refine_boundary(y_a, y_b, sr, anchor_a, anchor_b, resolution_ms, corr_threshold, margin_frames):
    """
    開始または終了の境界1点をフレーム単位でスライドして相関が最大になる点を探す。

    anchor_a, anchor_b : 境界の現在の時刻（秒）
    margin_frames      : 境界前後の検索幅（フレーム数）
                         例: margin_frames=5, resolution_ms=100 → 前後0.5秒をスライド
    戻り値 : (精緻化後のanchor_a, 精緻化後のanchor_b, correlation)
    """
    frame_sec = resolution_ms / 1000.0
    margin_sec = frame_sec * margin_frames
    win_frames = 8  # 相関計算に使うウィンドウ幅（フレーム数）

    # 境界前後のセグメントを切り出して特徴量を計算
    seg_start_a = max(0.0, anchor_a - margin_sec)
    seg_end_a   = min(len(y_a) / sr, anchor_a + margin_sec)
    seg_start_b = max(0.0, anchor_b - margin_sec)
    seg_end_b   = min(len(y_b) / sr, anchor_b + margin_sec)

    seg_a = y_a[int(seg_start_a * sr): int(seg_end_a * sr)]
    seg_b = y_b[int(seg_start_b * sr): int(seg_end_b * sr)]

    feat_a, time_res = _compute_features(seg_a, sr, resolution_ms)
    feat_b, _        = _compute_features(seg_b, sr, resolution_ms)

    if feat_a.shape[1] < win_frames or feat_b.shape[1] < win_frames:
        return anchor_a, anchor_b, None

    # anchorに対応するセグメント内フレーム位置
    center_a = int(margin_frames)
    center_b = int(margin_frames)

    # フレーム単位でスライドして相関が最大になる点を探す
    best_corr = -1.0
    best_offset_a = 0
    best_offset_b = 0

    for da in range(-margin_frames, margin_frames + 1):
        fi_a = center_a + da
        if fi_a < 0 or fi_a + win_frames > feat_a.shape[1]:
            continue
        for db in range(-margin_frames, margin_frames + 1):
            fi_b = center_b + db
            if fi_b < 0 or fi_b + win_frames > feat_b.shape[1]:
                continue

            vec_a = feat_a[:, fi_a: fi_a + win_frames].flatten()
            vec_b = feat_b[:, fi_b: fi_b + win_frames].flatten()

            mean_a = vec_a.mean()
            mean_b = vec_b.mean()
            num = np.sum((vec_a - mean_a) * (vec_b - mean_b))
            den = np.sqrt(np.sum((vec_a - mean_a)**2) * np.sum((vec_b - mean_b)**2))
            corr = num / den if den > 1e-8 else 0.0

            if corr > best_corr:
                best_corr = corr
                best_offset_a = da
                best_offset_b = db

    if best_corr < corr_threshold:
        return anchor_a, anchor_b, None

    refined_a = anchor_a + best_offset_a * frame_sec
    refined_b = anchor_b + best_offset_b * frame_sec
    return refined_a, refined_b, round(best_corr, 3)


# ============================
# マッチの精度向上（境界のみ再検索）
# ============================
def refine_match(match, y_a, y_b, sr, resolution_ms, corr_threshold, margin_frames):
    """
    粗いマッチの開始境界・終了境界だけを細かい分解能で再検索して絞り込む。
    中間部分は再計算しないので効率的。

    margin_frames : 境界前後の検索幅（フレーム数）。
                    実際の検索幅(秒) = resolution_ms/1000 * margin_frames
                    分解能が細かくなるほど検索幅も自動的に狭まる。
    """
    start_a = parse_time(match["videoA"]["start"])
    end_a   = parse_time(match["videoA"]["end"])
    start_b = parse_time(match["videoB"]["start"])
    end_b   = parse_time(match["videoB"]["end"])

    margin_sec = (resolution_ms / 1000.0) * margin_frames

    # 開始境界を精緻化
    refined_start_a, refined_start_b, start_corr = refine_boundary(
        y_a, y_b, sr, start_a, start_b, resolution_ms, corr_threshold, margin_frames
    )

    # 終了境界を精緻化
    refined_end_a, refined_end_b, end_corr = refine_boundary(
        y_a, y_b, sr, end_a, end_b, resolution_ms, corr_threshold, margin_frames
    )

    # どちらも見つからなければ元を返す
    if start_corr is None and end_corr is None:
        return match

    # 見つからなかった側は元の値を維持
    if start_corr is None:
        refined_start_a, refined_start_b = start_a, start_b
    if end_corr is None:
        refined_end_a, refined_end_b = end_a, end_b

    # 開始 > 終了になってしまう場合は元を返す
    if refined_start_a >= refined_end_a:
        return match

    refined_duration = refined_end_a - refined_start_a
    corrs = [c for c in [start_corr, end_corr] if c is not None]
    avg_corr = round(sum(corrs) / len(corrs), 3)

    return {
        "videoA": {
            "start": format_time(refined_start_a),
            "end":   format_time(refined_end_a)
        },
        "videoB": {
            "start": format_time(refined_start_b),
            "end":   format_time(refined_end_b)
        },
        "duration":    format_time(refined_duration),
        "correlation": avg_corr
    }
