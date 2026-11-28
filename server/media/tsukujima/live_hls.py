"""ライブの HLS 配信（iOS アプリの小窓 PiP 用）。

iOS の標準プレイヤー（AVPlayer）は流しっぱなしの MPEG-TS を再生できないので、ライブのエンコード出力
（mpegts の配信と同じもの）を映像のキーフレームで切って HLS にする。再エンコードはしない。

小窓に字幕・弾幕を焼き込むため、同じ流れから ARIB 字幕を読み、NX-Jikkyo の実況コメントも受ける。
どちらも「壁時計の時刻（UNIX 秒）」で持ち、HLS の各区切りにも同じ時計の EXT-X-PROGRAM-DATE-TIME を付ける
（アプリは映像の時刻からこの時計を引いて、字幕・コメントを合わせる）。

チューナーを握り続けないよう、しばらく取りに来なければ止める（アプリは開いている間 overlays を取り続ける）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from collections import deque
from datetime import datetime, timezone
from typing import ClassVar

logger = logging.getLogger(__name__)

TS = 188
CLOCK = 90000
WRAP = 1 << 33
# 区切りの長さ（秒）の目安。H.264 は 0.5 秒ごとにキーフレームがある
TARGET_SEC = 2.0
# 持っておく区切りの数と、プレイリストに載せる数
KEEP_SEGMENTS = 10
LIST_SEGMENTS = 6
# 取りに来なくなってから止めるまで（秒）。チューナーを他の局へ回せるよう短めにする
IDLE_SEC = 15.0
# 字幕・コメントを持っておく長さ（秒）
OVERLAY_KEEP_SEC = 180.0
JIKKYO_UA = 'ts-tag-bridge'


def _pes_pts(payload: bytes) -> int | None:
    """PES の先頭から PTS（90kHz）を読む。無ければ None。"""
    if len(payload) < 14 or payload[0:3] != b'\x00\x00\x01':
        return None
    if not (payload[7] & 0x80):
        return None
    p = payload[9:14]
    return (((p[0] >> 1) & 0x07) << 30) | (p[1] << 22) | ((p[2] >> 1) << 15) | (p[3] << 7) | (p[4] >> 1)


def _id3_aribb24(data: bytes) -> list[bytes]:
    """ID3 の中の PRIV（owner "aribb24.js"）を取り出す。tsreadex が字幕の PES をこの形で包む。"""
    out: list[bytes] = []
    j = data.find(b'ID3')
    if j < 0 or len(data) < j + 10:
        return out
    syncsafe = lambda b: (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]
    end = min(len(data), j + 10 + syncsafe(data[j + 6:j + 10]))
    q = j + 10
    while q + 10 <= end:
        fid = data[q:q + 4]
        size = syncsafe(data[q + 4:q + 8])
        body = data[q + 10:q + 10 + size]
        if fid == b'PRIV' and body.startswith(b'aribb24.js\x00'):
            out.append(body[len(b'aribb24.js\x00'):])
        if size <= 0:
            break
        q += 10 + size
    return out


class _CaptionOnly:
    """字幕 PID 1本ぶんの集め役。文字スーパー（data_identifier 0x81）は除く。
    ライブのエンコード出力では、字幕の PES は tsreadex が ID3（PRIV "aribb24.js"）に包んでいるので、
    中身を取り出して元の PES の形に戻してから渡す。"""

    def __init__(self, pid: int):
        from read_tsprogram.slim_caption_collector import SlimCaptionCollector
        # 集め役と同じ読み込み方にする（aribb24js は集め役が通した sys.path から読む）
        from aribb24js.lib.demuxer.mpegts_pes import PES_HEADER_SIZE, PES_header_length
        from aribb24js.lib.demuxer.b24_independent import parse_independent_pes

        collector = SlimCaptionCollector(pid)
        orig = collector._on_pes

        def on_pes(pes: bytes, last_video_pts_90k):
            head = PES_HEADER_SIZE + PES_header_length(pes)
            content = pes[head:]
            inner = _id3_aribb24(content) if b'ID3' in content[:16] else [content]
            for body in inner:
                ind = parse_independent_pes(body)
                if ind is None or ind.get('tag') != 'Caption':
                    continue
                orig(pes[:head] + body, last_video_pts_90k)

        collector._on_pes = on_pes
        self.collector = collector


class LiveHLS:
    """局・画質ごとに1つ。ライブの配信を読み続けて HLS の区切りと字幕・コメントを作る。"""

    _instances: ClassVar[dict[tuple[str, str], 'LiveHLS']] = {}

    @classmethod
    def get(cls, display_channel_id: str, quality: str) -> 'LiveHLS':
        key = (display_channel_id, quality)
        inst = cls._instances.get(key)
        if inst is None or inst.stopped:
            inst = LiveHLS(display_channel_id, quality)
            cls._instances[key] = inst
            inst.start()
        inst.touch()
        return inst

    @classmethod
    def find(cls, display_channel_id: str, quality: str) -> 'LiveHLS | None':
        inst = cls._instances.get((display_channel_id, quality))
        return inst if inst and not inst.stopped else None

    def __init__(self, display_channel_id: str, quality: str):
        self.channel_id = display_channel_id
        self.quality = quality
        self.stopped = False
        self.error: str | None = None
        self.last_access = time.time()
        self.segments: deque[dict] = deque(maxlen=KEEP_SEGMENTS)
        self.captions: deque[dict] = deque()
        self.comments: deque[dict] = deque()
        # 実況のある局か（無ければ _jikkyo_loop が下ろす）
        self.jikkyo = True
        self._tasks: list[asyncio.Task] = []
        self._seq = 0
        self._discontinuity = False
        # TS の読み取りの状態
        self._buf = b''
        self._pmt_pid: int | None = None
        self._pat_pkt: bytes | None = None
        self._pmt_pkt: bytes | None = None
        self._video_pid: int | None = None
        self._private_pids: set[int] = set()
        self._cap: dict[int, _CaptionOnly] = {}
        self._cap_lang: int | None = None
        self._cur: bytearray | None = None
        self._cur_pts: int | None = None
        self._cur_wall = 0.0
        self._last_video_pts: int | None = None
        # PTS → 壁時計（UNIX 秒）の対応（anchor_pts は巻き戻りを展開した値）
        self._anchor_pts: int | None = None
        self._anchor_wall = 0.0
        self._pts_offset = 0
        self._prev_raw_pts: int | None = None

    # ── 開始・停止 ──
    def start(self) -> None:
        self._tasks.append(asyncio.create_task(self._read_loop()))
        self._tasks.append(asyncio.create_task(self._watchdog()))
        self._tasks.append(asyncio.create_task(self._jikkyo_loop()))
        logger.info(f'[LiveHLS: {self.channel_id}/{self.quality}] 開始')

    def touch(self) -> None:
        self.last_access = time.time()

    def stop(self, reason: str = '') -> None:
        if self.stopped:
            return
        self.stopped = True
        for t in self._tasks:
            t.cancel()
        if LiveHLS._instances.get((self.channel_id, self.quality)) is self:
            del LiveHLS._instances[(self.channel_id, self.quality)]
        logger.info(f'[LiveHLS: {self.channel_id}/{self.quality}] 停止 {reason}')

    async def _watchdog(self) -> None:
        while not self.stopped:
            await asyncio.sleep(2)
            if time.time() - self.last_access > IDLE_SEC:
                self.stop('（取りに来なくなった）')

    async def _read_loop(self) -> None:
        from media.tsukujima.live_stream import LiveStream
        live = LiveStream(self.channel_id, self.quality)  # type: ignore[arg-type]
        client = await live.connect('mpegts')
        try:
            while not self.stopped:
                if live.getStatus().status == 'Offline':
                    break
                data = await client.readStreamData()
                if data is None:
                    break
                if data:
                    self._feed(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # 読み取りの失敗で配信ごと落とさない
            logger.exception(f'[LiveHLS: {self.channel_id}/{self.quality}] 読み取りに失敗: {e}')
            self.error = str(e)
        finally:
            live.disconnect(client)
            # 配信が終わった（局の切り替えでチューナーを譲った等）。繋ぎ直すとチューナーを取り返しに行くので止める
            self.stop('（配信が終わった）')

    # ── TS を区切る ──
    def _feed(self, data: bytes) -> None:
        buf = self._buf + data
        i = 0
        n = len(buf)
        while i + TS <= n:
            if buf[i] != 0x47:
                j = buf.find(b'\x47', i + 1)
                if j < 0:
                    i = n
                    break
                i = j
                continue
            self._packet(buf[i:i + TS])
            i += TS
        self._buf = buf[i:]

    def _packet(self, pkt: bytes) -> None:
        pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
        pusi = bool(pkt[1] & 0x40)
        afc = (pkt[3] >> 4) & 0x03
        off = 4
        rai = False
        if afc & 0x02:
            alen = pkt[4]
            if alen > 0:
                rai = bool(pkt[5] & 0x40)
            off = 5 + alen
        payload = pkt[off:] if (afc & 0x01) and off < TS else b''

        if pid == 0:
            if pusi and payload:
                self._pat_pkt = pkt
                self._parse_pat(payload)
        elif pid == self._pmt_pid:
            if pusi and payload:
                self._pmt_pkt = pkt
                self._parse_pmt(payload)
        elif pid == self._video_pid and pusi and payload:
            pts = _pes_pts(payload)
            if pts is not None:
                self._last_video_pts = pts
                if rai:
                    self._on_keyframe(pts)

        if pid in self._private_pids:
            cap = self._cap.get(pid)
            if cap is None:
                cap = self._cap[pid] = _CaptionOnly(pid)
            cap.collector.feed(pkt, self._last_video_pts)
            if cap.collector.captions:
                self._take_captions(cap.collector.captions)
                cap.collector.captions.clear()

        if self._cur is not None:
            self._cur += pkt

    def _parse_pat(self, payload: bytes) -> None:
        p = 1 + payload[0]
        if p + 8 > len(payload):
            return
        sec_len = ((payload[p + 1] & 0x0F) << 8) | payload[p + 2]
        end = min(p + 3 + sec_len - 4, len(payload))
        q = p + 8
        while q + 4 <= end:
            prog = (payload[q] << 8) | payload[q + 1]
            if prog != 0:
                self._pmt_pid = ((payload[q + 2] & 0x1F) << 8) | payload[q + 3]
                return
            q += 4

    def _parse_pmt(self, payload: bytes) -> None:
        p = 1 + payload[0]
        if p + 12 > len(payload):
            return
        sec_len = ((payload[p + 1] & 0x0F) << 8) | payload[p + 2]
        info_len = ((payload[p + 10] & 0x0F) << 8) | payload[p + 11]
        end = min(p + 3 + sec_len - 4, len(payload))
        q = p + 12 + info_len
        privs: set[int] = set()
        while q + 5 <= end:
            stype = payload[q]
            epid = ((payload[q + 1] & 0x1F) << 8) | payload[q + 2]
            es_len = ((payload[q + 3] & 0x0F) << 8) | payload[q + 4]
            if stype in (0x1B, 0x24) and self._video_pid is None:
                self._video_pid = epid
            elif stype in (0x06, 0x15):
                # 字幕の PES。ライブのエンコーダー（ffmpeg）は 0x15（ID3 の名札）で出す
                privs.add(epid)
            q += 5 + es_len
        self._private_pids = privs

    def _unwrap(self, raw: int) -> int:
        if self._prev_raw_pts is not None:
            d = raw - self._prev_raw_pts
            if d < -WRAP // 2:
                self._pts_offset += WRAP
            elif d > WRAP // 2:
                self._pts_offset -= WRAP
        self._prev_raw_pts = raw
        return raw + self._pts_offset

    def _wall_of(self, raw_pts: int) -> float:
        """字幕の PTS を壁時計へ。映像と同じ対応を使う（巻き戻りは映像の直近で判断）。"""
        if self._anchor_pts is None:
            return time.time()
        base = self._prev_raw_pts if self._prev_raw_pts is not None else raw_pts
        d = raw_pts - base
        if d < -WRAP // 2:
            d += WRAP
        elif d > WRAP // 2:
            d -= WRAP
        return self._anchor_wall + ((base + self._pts_offset + d) - self._anchor_pts) / CLOCK

    def _on_keyframe(self, raw_pts: int) -> None:
        now = time.time()
        jumped = self._prev_raw_pts is not None and not (0 <= ((raw_pts - self._prev_raw_pts) % WRAP) < 10 * CLOCK)
        pts = self._unwrap(raw_pts)
        if jumped:
            # エンコードのやり直しなどで時刻が飛んだ。区切りを閉じて対応を取り直す
            self._close_segment(None)
            self._anchor_pts = None
            self._discontinuity = True
        wall = None
        if self._anchor_pts is not None:
            wall = self._anchor_wall + (pts - self._anchor_pts) / CLOCK
            # 時計がずれてきたら合わせ直す（受信の詰まり等）
            if abs(now - wall) > 8:
                wall = None
        if wall is None:
            self._anchor_pts = pts
            self._anchor_wall = now
            wall = now
        if self._cur is not None and self._cur_pts is not None and (pts - self._cur_pts) / CLOCK < TARGET_SEC:
            return
        self._close_segment(pts)
        # 区切りの頭に PAT・PMT を置く（途中から読み始めても中身が分かるように）
        self._cur = bytearray((self._pat_pkt or b'') + (self._pmt_pkt or b''))
        self._cur_pts = pts
        self._cur_wall = wall

    def _close_segment(self, next_pts: int | None) -> None:
        if self._cur is None or self._cur_pts is None:
            self._cur = None
            return
        if next_pts is None:
            self._cur = None
            return
        dur = (next_pts - self._cur_pts) / CLOCK
        if dur > 0:
            self.segments.append({
                'seq': self._seq, 'data': bytes(self._cur), 'duration': dur,
                'wall': self._cur_wall, 'disc': self._discontinuity,
            })
            self._seq += 1
            self._discontinuity = False
        self._cur = None

    def _take_captions(self, entries: list[dict]) -> None:
        for e in entries:
            tokens = e.get('tokens')
            if not tokens or not any(t.get('tag') == 'Character' for t in tokens):
                continue
            lang = (e.get('caption_data') or {}).get('lang')
            if self._cap_lang is None:
                self._cap_lang = lang
            elif lang != self._cap_lang:
                continue  # 第2言語は出さない（録画の字幕1と同じ）
            self.captions.append({
                'pts': round(self._wall_of(round(e['pts'] * CLOCK) % WRAP), 3),
                'tokens': tokens,
                'duration_ms': e.get('duration_ms'),
                'clear_screen': e.get('clear_screen'),
            })
        cut = time.time() - OVERLAY_KEEP_SEC
        while self.captions and self.captions[0]['pts'] < cut:
            self.captions.popleft()

    # ── 出すもの ──
    def playlist(self) -> str | None:
        segs = list(self.segments)[-LIST_SEGMENTS:]
        if len(segs) < 3:
            return None
        target = max(math.ceil(s['duration']) for s in segs)
        lines = ['#EXTM3U', '#EXT-X-VERSION:3', f'#EXT-X-TARGETDURATION:{target}', f'#EXT-X-MEDIA-SEQUENCE:{segs[0]["seq"]}']
        for s in segs:
            if s['disc']:
                lines.append('#EXT-X-DISCONTINUITY')
            dt = datetime.fromtimestamp(s['wall'], tz=timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            lines.append(f'#EXT-X-PROGRAM-DATE-TIME:{dt}')
            lines.append(f'#EXTINF:{s["duration"]:.3f},')
            lines.append(f'segment.ts?seq={s["seq"]}')
        return '\n'.join(lines) + '\n'

    def segment(self, seq: int) -> bytes | None:
        for s in self.segments:
            if s['seq'] == seq:
                return s['data']
        return None

    def overlays(self, since: float) -> dict:
        return {
            'now': time.time(),
            'jikkyo': self.jikkyo,
            'captions': [c for c in self.captions if c['pts'] > since],
            'comments': [c for c in self.comments if c['time'] > since],
        }

    # ── 実況（NX-Jikkyo）。元の jikkyo.jsx の LiveCommentManager の受信と同じ手順 ──
    def _add_comment(self, chat: dict) -> None:
        from read_tsprogram.comments import _parse_comment_color, _parse_comment_position
        text = chat.get('content') or ''
        if not text or chat.get('date') is None:
            return
        mail = chat.get('mail') or ''
        toks = mail.split()
        self.comments.append({
            'time': round(int(chat['date']) + int(chat.get('date_usec') or 0) / 1_000_000, 3),
            'text': text,
            'color': _parse_comment_color(mail),
            'type': _parse_comment_position(mail),
            'size': 'big' if 'big' in toks else 'small' if 'small' in toks else 'medium',
            'user_id': chat.get('user_id'),
            'premium': chat.get('premium'),
        })
        cut = time.time() - OVERLAY_KEEP_SEC
        while self.comments and self.comments[0]['time'] < cut:
            self.comments.popleft()

    async def _jikkyo_loop(self) -> None:
        import aiohttp
        from media.tsukujima.jikkyo import get_jikkyo_id
        from media.tsukujima.live_stream import LiveStream

        info = LiveStream.resolve_channel(self.channel_id)
        jk = get_jikkyo_id(info['network_id'], info['service_id']) if info else None
        if jk is None:
            self.jikkyo = False
            return
        base = f'wss://nx-jikkyo.tsukumijima.net/api/v1/channels/{jk}/ws'
        while not self.stopped:
            try:
                async with aiohttp.ClientSession(headers={'User-Agent': JIKKYO_UA}) as http:
                    await self._jikkyo_once(http, base)
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.info(f'[LiveHLS: {self.channel_id}] 実況の接続が切れた: {e}')
            await asyncio.sleep(5)

    async def _jikkyo_once(self, http, base: str) -> None:
        async with http.ws_connect(f'{base}/watch') as watch:
            await watch.send_json({'type': 'startWatching', 'data': {'reconnect': False}})
            keep: asyncio.Task | None = None
            comment: asyncio.Task | None = None
            try:
                async for msg in watch:
                    if msg.type != 1:  # TEXT 以外（閉じた・エラー）
                        break
                    m = json.loads(msg.data)
                    t = m.get('type')
                    if t == 'ping':
                        await watch.send_json({'type': 'pong'})
                    elif t == 'seat' and keep is None:
                        sec = float((m.get('data') or {}).get('keepIntervalSec') or 30)
                        keep = asyncio.create_task(self._keep_seat(watch, sec))
                    elif t in ('room', 'messageServer') and comment is None:
                        d = m.get('data') or {}
                        if t == 'room':
                            uri, thread, key = d['messageServer']['uri'], d.get('threadId', ''), d.get('yourPostKey')
                        else:
                            uri, thread, key = f'{base}/comment', '', f'nicolive:{d.get("hashedUserId")}'
                        comment = asyncio.create_task(self._comment_session(http, uri, thread, key))
                        # コメントの側が切れたら視聴の側も閉じて、最初から繋ぎ直す
                        comment.add_done_callback(lambda _t: asyncio.ensure_future(watch.close()))
                    elif t in ('disconnect', 'reconnect'):
                        break
                    elif t == 'error':
                        code = (m.get('data') or {}).get('code')
                        if code not in ('COMMENT_POST_NOT_ALLOWED', 'INVALID_MESSAGE'):
                            break
            finally:
                for task in (keep, comment):
                    if task:
                        task.cancel()

    async def _keep_seat(self, watch, sec: float) -> None:
        while True:
            await asyncio.sleep(sec)
            await watch.send_json({'type': 'keepSeat'})

    async def _comment_session(self, http, uri: str, thread: str, key: str | None) -> None:
        async with http.ws_connect(uri) as ws:
            await ws.send_json([
                {'ping': {'content': 'rs:0'}}, {'ping': {'content': 'ps:0'}},
                {'thread': {'version': '20061206', 'thread': thread, 'threadkey': key, 'user_id': '', 'res_from': -100}},
                {'ping': {'content': 'pf:0'}}, {'ping': {'content': 'rf:0'}},
            ])
            async for msg in ws:
                if msg.type != 1:
                    break
                m = json.loads(msg.data)
                chat = m.get('chat') if isinstance(m, dict) else None
                if chat:
                    self._add_comment(chat)
