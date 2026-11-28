# This file is derived from KonomiTV (https://github.com/tsukumijima/KonomiTV)
# Original Copyright (c) 2021-2026 tsukumi
# Licensed under the MIT License
#
# Modifications by encode_auto project
#
# 移植元: server/app/utils/JikkyoClient.py の __getJikkyoChannelID()
# NX-Jikkyo 専用のため、ニコニコチャンネル ID 連携・スクレイピング・wsendpoint 取得は移植していない。

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# 実況チャンネル ID とサービス ID (SID)・ネットワーク ID (NID) の対照表
# NicoJK の jkch.sh.txt (https://github.com/xtne6f/NicoJK/blob/master/jkch.sh.txt) をベースに、
# 情報更新の上で JSON に変換したもの (KonomiTV server/static/jikkyo_channels.json をそのままコピー)
_JIKKYO_CHANNELS_PATH = Path(__file__).parent / 'jikkyo_channels.json'
with open(_JIKKYO_CHANNELS_PATH, encoding='utf-8') as _file:
    JIKKYO_CHANNELS: list[dict[str, Any]] = json.load(_file)

# 現在 NX-Jikkyo に存在する (実況可能な) 実況チャンネル ID の集合
# KonomiTV の JIKKYO_CHANNEL_ID_MAP のキーに相当する
# jikkyo_channels.json には現在は存在しない実況チャンネルの ID (ex: jk256) も含まれているため、この集合で絞り込む
VALID_JIKKYO_IDS: frozenset[str] = frozenset({
    'jk1', 'jk2', 'jk4', 'jk5', 'jk6', 'jk7', 'jk8', 'jk9',
    'jk10', 'jk11', 'jk12', 'jk13', 'jk14',
    'jk101', 'jk103', 'jk141', 'jk151', 'jk161', 'jk171', 'jk181', 'jk191',
    'jk192', 'jk193', 'jk200', 'jk201', 'jk211', 'jk222', 'jk236', 'jk252',
    'jk260', 'jk263', 'jk265', 'jk333',
})


def get_jikkyo_id(network_id: int, service_id: int) -> str | None:
    """
    ネットワーク ID + サービス ID に対応する実況チャンネル ID (ex: jk101) を取得する
    対応する実況チャンネル ID が存在しない場合は None を返す
    移植元: JikkyoClient.__getJikkyoChannelID()

    Args:
        network_id (int): チャンネルのネットワーク ID
        service_id (int): チャンネルのサービス ID

    Returns:
        str | None: 実況チャンネル ID (対応する実況チャンネルが存在しない場合は None)
    """

    # ネットワーク ID + サービス ID に対応する実況チャンネル ID を特定する
    for jikkyo_channel in JIKKYO_CHANNELS:

        # マッチ条件が複雑すぎるので、絞り込みのための関数を定義する
        def match() -> bool:

            # jikkyo_channels.json に定義されている NID と SID
            jikkyo_network_id = jikkyo_channel['network_id']
            jikkyo_service_id = int(jikkyo_channel['service_id'], 0)  # 16進数の文字列を数値に変換

            # NID と SID が一致する
            # BS・CS の場合はこれだけで OK
            if network_id == jikkyo_network_id and service_id == jikkyo_service_id:
                return True

            # NID が地上波の ID 範囲 (0x7880 ～ 0x7fef) で、かつ jikkyo_channels.json 記載の NID が 15（地上波）であれば
            # jikkyo_channels.json 記載の地上波の NID はなぜか 15 で固定なので、地上波で絞り込めたら後はサービス ID のみで特定する
            if 0x7880 <= network_id <= 0x7fef and jikkyo_network_id == 15:

                # サービス ID が一致する
                if service_id == jikkyo_service_id:
                    return True

                # サブチャンネル用で、jikkyo_channels.json にはサブチャンネルは定義されていないため必要
                # 地上波の場合はサービス ID は別チャンネルと隣合わせにならないようになっているはず
                # 地上波のサブチャンネルはおそらく最大3つなのでこれでカバーしきれるはず

                # 1つ前のサービス ID なら一致する
                # たとえば SID が 1025 (NHK総合2・東京) の場合、1つ前の 1024 (NHK総合1・東京) であれば定義があるので一致する
                if service_id - 1 == jikkyo_service_id:
                    return True

                # 2つ前のサービス ID なら一致する
                # たとえば SID が 1034 (NHKEテレ3東京) の場合、2つ前の 1032 (NHKEテレ1東京) であれば定義があるので一致する
                if service_id - 2 == jikkyo_service_id:
                    return True

            # ここまでの条件に一致しなかったら False を返す
            # CATV・SKY・BS4K は実況チャンネル/コミュニティ自体が存在しない
            return False

        # 上記の条件に一致し、かつ実況チャンネル ID が存在する場合のみ
        # -1 は対応するニコニコ実況チャンネルが存在しないことを示す
        if match() and jikkyo_channel['jikkyo_id'] != -1:
            jikkyo_id = 'jk' + str(jikkyo_channel['jikkyo_id'])

            # さらに対照表 (現在 NX-Jikkyo に存在する実況チャンネル) に含まれるかをチェックする
            if jikkyo_id in VALID_JIKKYO_IDS:
                return jikkyo_id

    # 実況チャンネル ID が取得できていなければ None を返す
    return None
