"""共通区間の探索と、境界の精緻化"""

import numpy as np
from .features import build_hash_index, compute_correlation, format_time, parse_time  # noqa: F401


# ============================
# 高速オーバーラップ探索
# ============================
def find_overlaps_fast(feat_a, feat_b, min_match_frames, time_res, corr_threshold=0.85,
                       max_dist=2.0):
    idx_b = build_hash_index(feat_b)

    matches = []
    used_a = set()
    used_b = set()

    for i in range(feat_a.shape[1]):
        if i in used_a:
            continue

        h = int(feat_a[0, i] / 0.5)

        for j in idx_b.get(h, []):
            if j in used_b:
                continue

            corr = compute_correlation(feat_a, feat_b, i, j)
            if corr < corr_threshold:
                continue

            k = 0
            while (
                i + k < feat_a.shape[1]
                and j + k < feat_b.shape[1]
                and (i + k) not in used_a
                and (j + k) not in used_b
            ):
                diff = np.abs(feat_a[:, i + k] - feat_b[:, j + k])
                dist = np.sqrt(np.sum(diff ** 2))

                if dist < max_dist:
                    k += 1
                else:
                    break

            if k >= min_match_frames:
                if k > 3:
                    final_corr = compute_correlation(feat_a, feat_b, i + k // 2, j + k // 2, window=k)
                    if final_corr < corr_threshold:
                        continue

                for offset in range(k):
                    used_a.add(i + offset)
                    used_b.add(j + offset)

                start_time_a = i * time_res
                end_time_a = (i + k) * time_res
                start_time_b = j * time_res
                end_time_b = (j + k) * time_res
                duration = k * time_res

                matches.append({
                    "videoA": {
                        "start": format_time(start_time_a),
                        "end": format_time(end_time_a)
                    },
                    "videoB": {
                        "start": format_time(start_time_b),
                        "end": format_time(end_time_b)
                    },
                    "duration": format_time(duration),
                    "correlation": round(final_corr if k > 3 else corr, 3)
                })
                break

    return matches


# ============================
# 2段階検出
# ============================
def two_stage_detection(feat_a, feat_b, first_min_match, second_min_match, time_res, corr_threshold,
                        max_dist=2.0):
    print(f"\n[Stage 1] Finding long matches (>= {first_min_match * time_res:.1f}s)...")

    coarse_matches = find_overlaps_fast(feat_a, feat_b, first_min_match, time_res, corr_threshold,
                                        max_dist=max_dist)
    print(f"Found {len(coarse_matches)} long matches")

    used_a = set()
    used_b = set()
    for match in coarse_matches:
        start_a = int(parse_time(match["videoA"]["start"]) / time_res)
        end_a = int(parse_time(match["videoA"]["end"]) / time_res)
        start_b = int(parse_time(match["videoB"]["start"]) / time_res)
        end_b = int(parse_time(match["videoB"]["end"]) / time_res)

        for i in range(start_a, end_a):
            used_a.add(i)
        for j in range(start_b, end_b):
            used_b.add(j)

    print(f"\n[Stage 2] Finding short matches (>= {second_min_match * time_res:.1f}s) in remaining regions...")

    idx_b = build_hash_index(feat_b)
    short_matches = []

    for i in range(feat_a.shape[1]):
        if i in used_a:
            continue

        h = int(feat_a[0, i] / 0.5)

        for j in idx_b.get(h, []):
            if j in used_b:
                continue

            corr = compute_correlation(feat_a, feat_b, i, j)
            if corr < corr_threshold:
                continue

            k = 0
            while (
                i + k < feat_a.shape[1]
                and j + k < feat_b.shape[1]
                and (i + k) not in used_a
                and (j + k) not in used_b
            ):
                diff = np.abs(feat_a[:, i + k] - feat_b[:, j + k])
                dist = np.sqrt(np.sum(diff ** 2))

                if dist < 2.0:
                    k += 1
                else:
                    break

            if k >= second_min_match:
                if k > 3:
                    final_corr = compute_correlation(feat_a, feat_b, i + k // 2, j + k // 2, window=k)
                    if final_corr < corr_threshold:
                        continue

                for offset in range(k):
                    used_a.add(i + offset)
                    used_b.add(j + offset)

                start_time_a = i * time_res
                end_time_a = (i + k) * time_res
                start_time_b = j * time_res
                end_time_b = (j + k) * time_res
                duration = k * time_res

                short_matches.append({
                    "videoA": {
                        "start": format_time(start_time_a),
                        "end": format_time(end_time_a)
                    },
                    "videoB": {
                        "start": format_time(start_time_b),
                        "end": format_time(end_time_b)
                    },
                    "duration": format_time(duration),
                    "correlation": round(final_corr if k > 3 else corr, 3)
                })
                break

    print(f"Found {len(short_matches)} short matches")

    all_matches = coarse_matches + short_matches
    all_matches.sort(key=lambda x: parse_time(x["videoA"]["start"]))

    return all_matches
