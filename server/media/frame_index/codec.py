"""映像の PID・コーデックと、ピクチャの種類（H.264 / H.265）の判定"""

from typing import Optional
from read_tsprogram import PacketChecker


_TOT_PID = 0x14         # TDT/TOT。放送の実時刻（JST）
_PTS_CYCLE = 1 << 33
_CLOCK = 90000
_HEAD_BYTES = 700  # seq header(量子化マトリクス込max~150B)+ext+GOP+picture+pic_ext が収まる長さ

# AMTのPICTURE_TYPE相当 → エントリ数
_PIC_FRAME = 'FRAME'
_PIC_TFF = 'TFF'
_PIC_BFF = 'BFF'
_PIC_TFF_RFF = 'TFF_RFF'
_PIC_BFF_RFF = 'BFF_RFF'
_PIC_FRAME_DOUBLING = 'DOUBLING'
_PIC_FRAME_TRIPLING = 'TRIPLING'
_ENTRY_COUNT = {
    _PIC_FRAME: 1, _PIC_TFF: 1, _PIC_BFF: 1, _PIC_TFF_RFF: 1,
    _PIC_BFF_RFF: 2, _PIC_FRAME_DOUBLING: 2, _PIC_FRAME_TRIPLING: 3,
}
# 各エントリの halfDelay(原典 StreamReform.cpp:719-752)。
# True のエントリは「偶数ライン=直前ピクチャ / 奇数ライン=このピクチャ」で
# 合成した絵になる(原典 AMTSource.cpp:451-460 と AMTSource.h:125-134 Copy1)。
# BFF 系だけが立つので、プルダウンの無い素材では全部 False になる。
_ENTRY_HALF = {
    _PIC_FRAME: (False,), _PIC_TFF: (False,), _PIC_TFF_RFF: (False,),
    _PIC_FRAME_DOUBLING: (False, False),
    _PIC_FRAME_TRIPLING: (False, False, False),
    _PIC_BFF: (True,),
    _PIC_BFF_RFF: (True, False),
}


def _video_pid_and_codec(ts_path: str):
    """phase1(先頭10万pkt)のPMT解析から対象映像PID・コーデック名・主音声PIDを得る。

    多プログラムTSでは PacketChecker の実データ選択(キーフレーム数)で
    対象ストリームを選ぶ(統合走査と同じストリームを見る)。
    主音声は選んだ映像と同じプログラムの、PMT に並んでいる先頭の音声PID
    （二カ国語だと2本あり、その1本目。ffmpeg の 0:a:0 と同じ選び方）。

    戻り値: (video_pid, codec, audio_pid)
    """
    pc = PacketChecker()
    pc._run_phase1(ts_path)
    pc._select_target_streams()
    pid = pc.video_pid
    if pid is None:
        return None, None, None
    apid = None
    for prog in pc.programs.values():
        if pid in prog['video_pids'] and prog.get('audio_pids'):
            apid = prog['audio_pids'][0]
            break
    label = pc.streams.get(pid, '')
    if 'H.264' in label:
        return pid, 'H.264', apid
    if 'H.265' in label:
        return pid, 'H.265', apid
    return pid, 'MPEG-2', apid


# ---------------------------------------------------------------------------
# H.265 / HEVC
# ---------------------------------------------------------------------------
# 原典 HEVCVideoParser.cpp:270-288 は libav のパーサに任せ、picture_structure と
# field_order から PIC_* を決めている。**RFF は無く FRAME/TFF/BFF しか出ない**ので、
# 1ピクチャ=1エントリ、halfDelay は BFF のときだけ、と MPEG-2 より単純になる。


def _find_ext(head: bytes, ext_id: int) -> int:
    """extension_start_code(00 00 01 B5) で extension_id が一致する位置(ペイロード先頭)を返す。"""
    i = 0
    while True:
        i = head.find(b'\x00\x00\x01\xb5', i)
        if i < 0:
            return -1
        p = i + 4
        if p < len(head) and (head[p] >> 4) == ext_id:
            return p
        i += 4


def _classify_picture(head: bytes, progressive_seq: int) -> Optional[str]:
    """ピクチャ先頭ESからAMT(Mpeg2VideoParser.cpp)と同じピクチャ種別を返す。

    Returns:
        _PIC_* / None(picture coding extension が見つからない)
    Raises:
        RuntimeError: フィールドピクチャ構成(picture_structure!=3, 未対応)
    """
    p = _find_ext(head, 0x8)  # Picture Coding Extension
    if p < 0 or p + 4 >= len(head):
        return None
    # bits: extid(4) f_code(16) intra_dc(2) picture_structure(2) tff(1) ...
    #       ... concealment(1) q_scale(1) intra_vlc(1) alt_scan(1) rff(1)
    ps = head[p + 2] & 0x03
    tff = (head[p + 3] >> 7) & 1
    rff = (head[p + 3] >> 1) & 1
    if ps == 1 or ps == 2:
        # フィールドピクチャ: AMTは2フィールドを1フレームに合成する
        # (Mpeg2VideoParser.cpp case 1: PIC_TFF / case 2: PIC_BFF)。
        # 放送では2フィールドが同一PESに入るため PES=1エントリでよい
        # (一部CM等が部分的にフィールド構成を使う実録画で確認)
        return _PIC_TFF if ps == 1 else _PIC_BFF
    if progressive_seq:
        if rff == 0:
            return _PIC_FRAME
        return _PIC_FRAME_TRIPLING if tff else _PIC_FRAME_DOUBLING
    if rff == 0:
        return _PIC_TFF if tff else _PIC_BFF
    return _PIC_TFF_RFF if tff else _PIC_BFF_RFF
