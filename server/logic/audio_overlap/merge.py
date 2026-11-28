"""マッチのまとめと解析の入口（analyze）"""

import os
import tempfile
from .features import (  # noqa: F401
    _keep_dir,
    audio_to_features,
    extract_audio,
    format_time,
    parse_time,
)
from .search import find_overlaps_fast, two_stage_detection  # noqa: F401
from .refine import refine_match  # noqa: F401
from .gaps import _merge_equal_gaps, _attach_gaps  # noqa: F401


# ============================
# 多段階精度向上
# ============================
def multi_resolution_refine(matches, y_a, y_b, sr, resolution_stages_ms, corr_threshold, margin_frames):
    """
    複数の分解能段階を順に適用してマッチ境界を段階的に絞り込む。

    Parameters
    ----------
    matches               : 粗い検出結果のリスト
    y_a, y_b              : 全音声データのndarray
    sr                    : サンプリングレート
    resolution_stages_ms  : 分解能のリスト(ms、粗→細の順) 例: [250, 125]
    corr_threshold        : 相関しきい値
    margin_frames         : 各段階での境界検索幅（フレーム数）
                            実際の検索幅(秒) = resolution_ms/1000 * margin_frames
    """
    refined = matches
    for stage_idx, res_ms in enumerate(resolution_stages_ms):
        margin_sec = (res_ms / 1000.0) * margin_frames
        print(f"\n[Refine Stage {stage_idx + 1}] 分解能: {res_ms}ms  margin: {margin_sec:.2f}s ({margin_frames}フレーム)")
        next_refined = []
        for i, match in enumerate(refined):
            r = refine_match(match, y_a, y_b, sr, res_ms, corr_threshold, margin_frames)
            orig_start_a = parse_time(match["videoA"]["start"])
            new_start_a  = parse_time(r["videoA"]["start"])
            orig_end_a   = parse_time(match["videoA"]["end"])
            new_end_a    = parse_time(r["videoA"]["end"])
            delta_start  = new_start_a - orig_start_a
            delta_end    = new_end_a   - orig_end_a
            print(f"  Match {i+1}: A start {delta_start:+.3f}s, A end {delta_end:+.3f}s"
                  f"  corr: {match['correlation']:.3f} → {r['correlation']:.3f}")
            next_refined.append(r)
        refined = next_refined
    return refined


# ============================
# マッチの結合
# ============================
def merge_consecutive_matches(matches, gap_threshold=2.0):
    """videoAとvideoBの両方で連続するマッチのみ結合"""
    if not matches:
        return matches

    merged = []
    current = matches[0].copy()

    for next_match in matches[1:]:
        current_end_a  = parse_time(current["videoA"]["end"])
        next_start_a   = parse_time(next_match["videoA"]["start"])
        current_end_b  = parse_time(current["videoB"]["end"])
        next_start_b   = parse_time(next_match["videoB"]["start"])

        gap_a = next_start_a - current_end_a
        gap_b = next_start_b - current_end_b

        if gap_a <= gap_threshold and gap_b <= gap_threshold and abs(gap_a - gap_b) <= gap_threshold:
            current["videoA"]["end"] = next_match["videoA"]["end"]
            current["videoB"]["end"] = next_match["videoB"]["end"]
            duration = parse_time(current["videoA"]["end"]) - parse_time(current["videoA"]["start"])
            current["duration"] = format_time(duration)
            current["correlation"] = (current["correlation"] + next_match["correlation"]) / 2
            print(f"  Merged: A gap={gap_a:.1f}s, B gap={gap_b:.1f}s")
        else:
            if gap_a <= gap_threshold and gap_b > gap_threshold:
                print(f"  Not merged: A gap={gap_a:.1f}s (OK), B gap={gap_b:.1f}s (too large)")
            merged.append(current)
            current = next_match.copy()

    merged.append(current)
    return merged


# ============================
# main
# ============================

def bridge_same_offset(matches, tol=1.0, max_gap=None):
    """時間ずれが同じ連続マッチを、間の未検出区間ごと1つに繋げる。

    CMカット済み(trim_segments 適用済み)の動画同士は本編だけが並ぶため、ある区間で
    ずれ(A開始 - B開始)が一致していれば、その先の未検出部分も同じ本編が続いている
    可能性が高い。検出が細切れになっても実用上の共通区間として使えるようにする。

    tol: 同一とみなすずれの許容差(秒)。max_gap: 繋ぐ穴の上限(秒、None=無制限)。
    """
    if not matches:
        return matches
    first = matches[0]
    out = [dict(first, videoA=dict(first['videoA']), videoB=dict(first['videoB']))]
    for m in matches[1:]:
        prev = out[-1]
        off_prev = parse_time(prev['videoA']['start']) - parse_time(prev['videoB']['start'])
        off_cur = parse_time(m['videoA']['start']) - parse_time(m['videoB']['start'])
        gap_a = parse_time(m['videoA']['start']) - parse_time(prev['videoA']['end'])
        ok = (abs(off_cur - off_prev) <= tol and gap_a >= 0
              and (max_gap is None or gap_a <= max_gap))
        if ok:
            prev['videoA']['end'] = m['videoA']['end']
            prev['videoB']['end'] = m['videoB']['end']
            prev['duration'] = format_time(
                parse_time(prev['videoA']['end']) - parse_time(prev['videoA']['start']))
            prev['correlation'] = round(min(prev['correlation'], m['correlation']), 3)
        else:
            out.append(dict(m, videoA=dict(m['videoA']), videoB=dict(m['videoB'])))
    return out


def analyze(video_a, video_b, ffmpeg="ffmpeg", *, min_match=10, correlation=0.75, wav_dir=None,
            nice=0,
            resolution=500, max_dist=2.0, two_stage=False, first_min_match=80,
            refine=False, refine_resolutions=(250, 125), refine_margin_frames=5,
            merge_equal_gaps=False, bridge=False, bridge_tol=1.0, bridge_max_gap=None,
            on_log=None):
    """2本の動画の共通区間を検出して matches のリストを返す（ライブラリ入口）。

    CLI(main)と同じ手順・同じ既定値。on_log(str) を渡すと進捗を通知する。
    返り値の各要素: {videoA:{start,end}, videoB:{start,end}, duration, correlation,
    gap_from_prev?} で、時刻は "HH:MM:SS.mmm" 文字列（parse_time で秒へ戻せる）。
    """
    log = on_log or (lambda _m: None)

    # wav_dir を渡すと抽出結果をそこに残す。後段(frame_sync.refine)が同じ音声を
    # もう一度抽出しなくて済む(実測で往復 30秒ほどの節約)
    ctx = _keep_dir(wav_dir) if wav_dir else tempfile.TemporaryDirectory()
    with ctx as tmp:
        wav_a = os.path.join(tmp, "a.wav")
        wav_b = os.path.join(tmp, "b.wav")

        if not (os.path.exists(wav_a) and os.path.exists(wav_b)):
            log("音声を抽出中...")
            extract_audio(video_a, wav_a, ffmpeg=ffmpeg, nice=nice)
            extract_audio(video_b, wav_b, ffmpeg=ffmpeg, nice=nice)

        log(f"特徴量を計算中 (分解能 {resolution}ms)...")
        feat_a, time_res, y_a = audio_to_features(wav_a, resolution_ms=resolution)
        feat_b, _, y_b = audio_to_features(wav_b, resolution_ms=resolution)

        min_match_frames = max(3, int(min_match / time_res))
        log("共通区間を探索中...")
        if two_stage:
            matches = two_stage_detection(
                feat_a, feat_b, max(3, int(first_min_match / time_res)),
                min_match_frames, time_res, correlation, max_dist=max_dist)
        else:
            matches = find_overlaps_fast(
                feat_a, feat_b, min_match_frames, time_res, correlation, max_dist=max_dist)

        matches = merge_consecutive_matches(matches, gap_threshold=9.5)

        if refine and matches:
            log(f"境界を精緻化中 (段階 {list(refine_resolutions)}ms)...")
            matches = multi_resolution_refine(
                matches, y_a, y_b, sr=16000,
                resolution_stages_ms=list(refine_resolutions),
                corr_threshold=correlation, margin_frames=refine_margin_frames)
            matches = merge_consecutive_matches(matches, gap_threshold=9.5)

    if bridge and matches:
        before = len(matches)
        matches = bridge_same_offset(matches, tol=bridge_tol, max_gap=bridge_max_gap)
        log(f'ずれが同じ区間を連結: {before} → {len(matches)} 件')
    if merge_equal_gaps and len(matches) > 1:
        matches = _merge_equal_gaps(matches)
    _attach_gaps(matches)
    log(f"共通区間 {len(matches)} 件を検出しました")
    return matches
