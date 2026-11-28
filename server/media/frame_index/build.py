"""TS からフレーム表を作る（build_frame_table）"""

from typing import List, Optional, Tuple
from read_tsprogram.ts_utils import TSPacketUtil
from read_tsprogram.constants import TS_PACKET_SIZE, SYNC_BYTE
from read_tsprogram.tot import parse_tot as _parse_tot
from .codec import _ENTRY_COUNT, _ENTRY_HALF, _HEAD_BYTES, _PIC_FRAME, _PTS_CYCLE, _TOT_PID, _classify_picture, _find_ext, _video_pid_and_codec
from .uniform import _build_frame_table_uniform  # noqa: F401
from .h265 import _classify_picture_h265  # noqa: F401
from .pts_diff import signed_pts_diff


def build_frame_pts_list(ts_path: str) -> List[int]:
    """build_frame_table の PTS だけを返す(既存の呼び出し互換)。"""
    return build_frame_table(ts_path)[0]


def build_frame_table(ts_path: str):
    """TSから表示順の映像フレーム表(amts0.dat FilterSourceFrame互換)を生成する。

    音声も同じ1パスで拾う。音声PESのPTSが分かればAACユニットの位置が一意に決まり、
    ffmpeg のパケット分割に頼らずに済む(下の _audio_unit_pts 参照)。

    Returns:
        (framePTS, halfDelay, audio_pid, audioPES_PTS, totEntries)
        framePTS: [PTS(90kHz, 33bitラップ展開済み), ...] BFF_RFF等は同値を複数含む
        halfDelay: 同じ長さ。True は直前ピクチャと合成する絵(_ENTRY_HALF 参照)
        audio_pid: 主音声のPID(見つからなければ None)
        audioPES_PTS: 主音声PESのPTS列(デコード順=表示順)
        totEntries: [(datetime, 映像PTS)]。放送の実時刻。トリム・分割で相対時刻が
            変わっても動かない基準なので、CM位置を出力動画へ持ち越すときに使う

    Raises:
        RuntimeError: 映像PID未検出 / 未対応構成(H.264/H.265・フィールドピクチャ等)
    """
    video_pid, codec, audio_pid = _video_pid_and_codec(ts_path)
    if video_pid is None:
        raise RuntimeError(f'映像PIDが検出できません: {ts_path}')
    if codec == 'H.264':
        # H.264 は ES を解いて表を作れない（POC の算出とフィールド構成の解釈が要る）。
        # ただしプルダウンが無くフレーム間隔が一定なら「符号化フレーム＝出力フレーム」が
        # 1:1 で、表示PTSを並べるだけで MPEG-2 経路と同じ表になる。配信の取り込み
        # (29.97fps 固定・プログレッシブ)がこれに当たる。条件を満たさないものは
        # 従来どおり弾く（黙って間違えた表を作るより良い）。
        return _build_frame_table_uniform(ts_path, audio_pid)
    if codec not in ('MPEG-2', 'H.265'):
        raise RuntimeError(f'{codec} は未対応(CMCheck経路を使用): {ts_path}')
    is_h265 = (codec == 'H.265')

    # (pts, pic_type, is_gop_start) デコード順
    pictures: List[Tuple[int, str, bool]] = []
    no_ext_count = 0
    no_pts_count = 0

    # 33bitラップの展開。直前の「展開済み」値との符号付き差分で積み上げる。
    # 差分を取らず offset を足し込む方式だと、周回のまたぎでフレームの並びが
    # 前後する(実測: 8589926970 → 1387 → 8589929973 のように
    # 周回前後が入れ替わって出る)ときに、周回前のフレームまで1周ぶん進んでしまう
    prev_pts: Optional[int] = None
    progressive_seq = 0  # 直近のsequence_extension値(放送は通常0)
    h265_interlaced: Optional[int] = None   # 直近SPSの general_interlaced_source_flag

    tot_entries = []                # [(datetime, 映像PTS)] 放送の実時刻
    audio_pts: List[int] = []       # 主音声PESのPTS(33bitラップ展開済み)
    a_prev: Optional[int] = None    # 直前の展開済み音声PTS

    # 進行中ピクチャ(PUSIパケット + 続きの数パケットからヘッダ分を集める)
    cur_pts: Optional[int] = None
    cur_head: Optional[bytearray] = None

    def _finalize():
        nonlocal cur_pts, cur_head, progressive_seq, no_ext_count, h265_interlaced
        if cur_pts is None or cur_head is None:
            cur_pts, cur_head = None, None
            return
        head = bytes(cur_head)
        if is_h265:
            pic, is_irap, itl = _classify_picture_h265(head)
            if itl is not None:
                h265_interlaced = itl
            pictures.append((cur_pts, pic, is_irap))
            cur_pts, cur_head = None, None
            return
        is_gop = b'\x00\x00\x01\xb3' in head
        if is_gop:
            sp = _find_ext(head, 0x1)  # Sequence Extension
            if sp >= 0 and sp + 1 < len(head):
                progressive_seq = (head[sp + 1] >> 3) & 1
        try:
            pic = _classify_picture(head, progressive_seq)
        except RuntimeError:
            raise
        if pic is None:
            no_ext_count += 1
            pic = _PIC_FRAME  # 後で異常数を検査して打ち切る
        pictures.append((cur_pts, pic, is_gop))
        cur_pts, cur_head = None, None

    chunk_size = TS_PACKET_SIZE * 10000
    with open(ts_path, 'rb') as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            n = len(chunk) // TS_PACKET_SIZE
            for i in range(n):
                pkt = chunk[i * TS_PACKET_SIZE:(i + 1) * TS_PACKET_SIZE]
                if pkt[0] != SYNC_BYTE:
                    continue
                _pid = TSPacketUtil.get_pid(pkt)
                if _pid == _TOT_PID:
                    # 放送の実時刻。トリムや分割で相対時刻が変わっても動かない
                    # 唯一の基準なので、直前の映像PTSと組にして持っておく
                    if prev_pts is not None:
                        _t = _parse_tot(pkt)
                        if _t is not None:
                            tot_entries.append((_t, prev_pts))
                    continue
                if _pid == audio_pid:
                    if TSPacketUtil.has_payload_start(pkt):
                        _raw = TSPacketUtil.parse_pts(pkt)
                        if _raw is not None:
                            a_prev = _raw if a_prev is None else \
                                a_prev + signed_pts_diff(_raw, a_prev % _PTS_CYCLE)
                            audio_pts.append(a_prev)
                    continue
                if _pid != video_pid:
                    continue
                if TSPacketUtil.has_payload_start(pkt):
                    _finalize()
                    raw = TSPacketUtil.parse_pts(pkt)
                    if raw is None:
                        no_pts_count += 1
                        continue
                    prev_pts = raw if prev_pts is None else \
                        prev_pts + signed_pts_diff(raw, prev_pts % _PTS_CYCLE)
                    cur_pts = prev_pts
                    es = TSPacketUtil.pes_payload_start(pkt)
                    cur_head = bytearray(es) if es is not None else bytearray()
                elif cur_head is not None and len(cur_head) < _HEAD_BYTES:
                    # ヘッダ解析に必要な分だけ続きのペイロードを足す
                    off = TSPacketUtil.get_payload_offset(pkt)
                    if off < TS_PACKET_SIZE:
                        cur_head.extend(pkt[off:])

    # 末尾規則: デコード順最後のピクチャは確定できないため除外(_finalizeしない)

    if not pictures:
        raise RuntimeError(f'映像フレームが検出できません: {ts_path}')
    if no_pts_count:
        raise RuntimeError(f'PTSなし映像PESが{no_pts_count}件あります(未対応): {ts_path}')
    if not is_h265 and no_ext_count > len(pictures) * 0.001:
        raise RuntimeError(
            f'picture coding extension 不detected が {no_ext_count}件あります(未対応): {ts_path}')
    if is_h265 and h265_interlaced:
        # インターレースだと picture ごとの上下フィールドの順序が要るが、それは
        # Picture Timing SEI にしか無く、読むには VUI まで解く必要がある。
        # 放送(BS4K)も本機のエンコード出力もプログレッシブなので、来たら諦めて
        # CMCheck 経路へ落とす（黙って間違えるより良い）
        raise RuntimeError(f'H.265 のインターレース素材は未対応: {ts_path}')

    # 表示順に並べる
    pictures.sort(key=lambda t: t[0])

    # 先頭規則: 表示順で最初のGOP先頭(シーケンスヘッダ付きピクチャ)より前は除外
    start = next((i for i, t in enumerate(pictures) if t[2]), None)
    if start is None:
        raise RuntimeError(f'GOP先頭(I/RAP)が検出できません: {ts_path}')

    frames: List[int] = []
    half: List[bool] = []
    for pts, pic, _gop in pictures[start:]:
        frames.extend([pts] * _ENTRY_COUNT[pic])
        half.extend(_ENTRY_HALF[pic])
    return frames, half, audio_pid, audio_pts, tot_entries


# ---------------------------------------------------------------------------
# 時刻 → フレーム番号（Amatsukaze互換の明示PTS表ルックアップ）
# ---------------------------------------------------------------------------
