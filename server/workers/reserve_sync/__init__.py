"""予約の同期（EDCB の予約を見て、解析・しょぼいの情報の埋め・重複のスキップ）。

もとは workers/reserve_sync.py の1ファイル。ReserveSyncWorker のメソッドを機能ごとの mixin に分けた。"""
