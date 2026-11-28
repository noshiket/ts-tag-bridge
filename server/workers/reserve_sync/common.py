"""予約の同期ワーカー — 予約一覧をポーリングして text_parser 解析結果を DB に保存"""

import logging
from datetime import timedelta


logger = logging.getLogger('workers.reserve_sync')   # 分ける前と同じ名前で出す

# 解析エラーの残る予約を日次で解析し直すのは、放送がこれだけ先までのものに限る。
# しょぼいカレンダーの話数・副題は放送が近づいてから登録されるので、1週間先の予約を毎日
# 解析し直しても多くは同じ結果で、問い合わせだけが増える（429 で長時間規制
# された時点で、一方のサーバーは毎日 155件・もう一方は 108件をまとめて解析し直していた）。
# 番組情報(EPG)が変わった予約と、規制で飛ばした予約は期間に関係なく解析し直す
_PARSER_RETRY_WITHIN = timedelta(days=2)
# 規制が明けた後、規制で飛ばした予約を tick ごとにこの件数ずつ解析し直す（まとめて流さない）
_RATE_LIMITED_DRAIN_PER_TICK = 3
