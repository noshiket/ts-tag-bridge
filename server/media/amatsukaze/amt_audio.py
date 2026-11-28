"""Amatsukaze の音声の dat ファイルを読む"""

import numpy as np


def parse_amtsource_audio_frames(dat_file: str):
    """amts0.dat の FilterAudioFrame 配列を読む。

    原典: Amatsukaze/AMTSource.cpp:818-836 SaveAMTSource の書き出し順
          Amatsukaze/StreamReform.h:106-110 struct FilterAudioFrame

    .dat の並び:
      writeArray(srcpath) / writeArray(audiopath)
      writeValue(VideoFormat) / writeValue(AudioFormat)
      writeArray(FilterSourceFrame[])   ← amatsukaze_files.parse_amtsource_dat が読む
      writeArray(FilterAudioFrame[])    ← ここ
      writeValue(DecoderSetting)

    FilterAudioFrame は int frameIndex; int64_t waveOffset; int waveLength;
    でアライメント込み 24 バイト。

    戻り値: (waveOffset 配列 int64, waveLength 配列 int32)
    """
    import struct

    from .amatsukaze_files.frames import _AUDIOFORMAT_SIZE, _VIDEOFORMAT_SIZE

    with open(dat_file, 'rb') as f:
        data = f.read()

    pos = 0
    for _ in range(2):                      # srcpath, audiopath
        n = struct.unpack_from('<q', data, pos)[0]
        pos += 8 + n
    pos += _VIDEOFORMAT_SIZE + _AUDIOFORMAT_SIZE

    frame_count = struct.unpack_from('<q', data, pos)[0]
    pos += 8
    # FilterSourceFrame のサイズは版によって違う。audioFrames の個数が妥当に読めて、
    # かつ末尾が DecoderSetting ぶんだけ残る候補を選ぶ
    for frame_size in range(40, 257, 4):
        after = pos + frame_count * frame_size
        if after + 8 > len(data):
            continue
        n_audio = struct.unpack_from('<q', data, after)[0]
        if not (0 < n_audio < 10_000_000):
            continue
        end = after + 8 + n_audio * 24
        if 0 <= len(data) - end <= 64:
            arr = np.frombuffer(data, dtype=np.dtype([
                ('frameIndex', '<i4'), ('_pad0', '<i4'),
                ('waveOffset', '<i8'), ('waveLength', '<i4'), ('_pad1', '<i4'),
            ]), count=n_audio, offset=after + 8)
            return arr['waveOffset'].copy(), arr['waveLength'].copy()
    raise ValueError(f'{dat_file}: FilterAudioFrame 配列が見つかりません')


class AMTSourceDatAudio:
    """amts0.dat + audio.wav から Amatsukaze と同じ音声タイムラインを作る。

    原典: Amatsukaze/AMTSource.cpp:770-800 AMTSource::GetAudio
          同 :165-181 audioSamplesPerFrame / vi.num_audio_samples の決め方

    音声は AAC のアクセスユニット(通常 1024 サンプル)単位で管理され、各単位が
    wave ファイル内の自分のオフセットを持つ。欠落した単位はゼロ埋めされる。
    「先頭を N サンプル捨てる」ような単純なオフセットではないので、
    線形の frame*sr/rate*scale だけでは再現できない。
    """

    SAMPLE_BYTES = 4      # 16bit ステレオ前提（原典 :775）

    def __init__(self, dat_file: str, wave_file: str):
        self.waveOffset, self.waveLength = parse_amtsource_audio_frames(dat_file)
        # 原典 :166-174: 最初の waveLength!=0 を採用（既定 1024）
        nz = np.nonzero(self.waveLength)[0]
        self.audioSamplesPerFrame = (int(self.waveLength[nz[0]]) // self.SAMPLE_BYTES
                                     if nz.size else 1024)
        self.num_audio_samples = self.audioSamplesPerFrame * len(self.waveOffset)
        with open(wave_file, 'rb') as f:
            self._wave = np.frombuffer(f.read(), np.uint8)

    def GetAudio(self, start: int, count: int) -> np.ndarray:
        """原典: AMTSource.cpp:770-802 GetAudio

        [start, start+count) サンプルを int16 のインターリーブ列で返す。
        """
        aspf = self.audioSamplesPerFrame
        sb = self.SAMPLE_BYTES
        out = np.zeros(count * sb, np.uint8)
        ptr = 0
        frameIndex = start // aspf
        frameOffset = start % aspf
        n = len(self.waveOffset)
        while count > 0 and frameIndex < n:
            readBytes = min(aspf * sb - frameOffset * sb, count * sb)
            if self.waveLength[frameIndex] != 0:
                o = int(self.waveOffset[frameIndex]) + frameOffset * sb
                chunk = self._wave[o:o + readBytes]
                out[ptr:ptr + len(chunk)] = chunk
            # waveLength==0 はゼロ埋め（out が最初からゼロなので何もしない）
            ptr += readBytes
            count -= readBytes // sb
            frameIndex += 1
            frameOffset = 0
        return out.view('<i2')
