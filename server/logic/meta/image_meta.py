"""画像（PNG・JPEG）に情報を埋め込む・読む"""

import json
import struct
import zlib
from .common import META_KEY, logger


def embed_image_meta(raw: bytes, meta: dict) -> bytes:
    """画像バイト列にメタデータを埋めて返す。未対応形式はそのまま返す。"""
    text = json.dumps(meta, ensure_ascii=False)
    try:
        if raw[:8] == b'\x89PNG\r\n\x1a\n':
            return _png_embed(raw, text)
        if raw[:2] == b'\xff\xd8':
            return _jpeg_embed(raw, text)
    except Exception as e:
        logger.warning('画像へのメタデータ埋め込みに失敗(元のまま保存): %s', e)
    return raw


def read_image_meta(raw: bytes):
    """画像バイト列から埋め込みメタデータを読む。無ければ None。"""
    try:
        if raw[:8] == b'\x89PNG\r\n\x1a\n':
            text = _png_read(raw)
        elif raw[:2] == b'\xff\xd8':
            text = _jpeg_read(raw)
        else:
            return None
        return json.loads(text) if text else None
    except Exception as e:
        logger.debug('画像メタデータの読み出しに失敗: %s', e)
        return None


def _png_embed(raw: bytes, text: str) -> bytes:
    # iTXt: キーワード\0 圧縮フラグ 圧縮方式 言語タグ\0 翻訳キーワード\0 テキスト(UTF-8)
    payload = META_KEY.encode('latin-1') + b'\x00\x00\x00' + b'\x00' + b'\x00' + text.encode('utf-8')
    chunk = (struct.pack('>I', len(payload)) + b'iTXt' + payload
             + struct.pack('>I', zlib.crc32(b'iTXt' + payload) & 0xffffffff))
    end = raw.rindex(b'IEND') - 4          # IEND チャンクの長さフィールドの手前
    return raw[:end] + chunk + raw[end:]


def _png_read(raw: bytes):
    i = 8
    while i + 8 <= len(raw):
        ln = struct.unpack('>I', raw[i:i + 4])[0]
        typ = raw[i + 4:i + 8]
        if typ == b'IEND':
            break
        if typ in (b'iTXt', b'tEXt'):
            body = raw[i + 8:i + 8 + ln]
            key, _, rest = body.partition(b'\x00')
            if key.decode('latin-1', 'replace') == META_KEY:
                if typ == b'tEXt':
                    return rest.decode('utf-8', 'replace')
                # iTXt: 圧縮フラグ/方式/言語/翻訳キーワードを飛ばす
                if rest[:1] == b'\x01':
                    return None            # 圧縮版は書かないので未対応で良い
                rest = rest[2:]            # 圧縮フラグ + 圧縮方式
                _, _, rest = rest.partition(b'\x00')   # 言語タグ
                _, _, rest = rest.partition(b'\x00')   # 翻訳キーワード
                return rest.decode('utf-8', 'replace')
        i += 12 + ln
    return None


def _jpeg_embed(raw: bytes, text: str) -> bytes:
    body = text.encode('utf-8')
    if len(body) + 2 > 0xFFFF:
        raise ValueError('COMマーカーに入りません')
    seg = b'\xff\xfe' + struct.pack('>H', len(body) + 2) + body
    return raw[:2] + seg + raw[2:]


def _jpeg_read(raw: bytes):
    i = 2
    while i + 1 < len(raw):
        if raw[i] != 0xFF:
            return None
        marker = raw[i + 1]
        if marker == 0xD9 or marker == 0xDA:      # EOI / SOS 以降は走査しない
            return None
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            i += 2
            continue
        ln = struct.unpack('>H', raw[i + 2:i + 4])[0]
        if marker == 0xFE:                         # COM
            return raw[i + 4:i + 2 + ln].decode('utf-8', 'replace')
        i += 2 + ln
    return None
