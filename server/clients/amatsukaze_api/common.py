#!/usr/bin/env python3
"""Amatsukaze サーバー REST API クライアント

docs/AmatsukazeShared_investigation.md に基づき、Amatsukaze の全 REST API エンドポイントを
Python から利用するためのクライアントクラス。
edcb_api.py と同じスタイルで実装している。

Usage:
    from clients.amatsukaze_api import AmatsukazeClient
    client = AmatsukazeClient("http://localhost:32769")

    # 1. システム状態の取得
    sys_info = client.get_system()
    print("エンコーダー停止中:", sys_info["state"]["pause"])

    # 2. プロファイル一覧の取得
    profiles = client.get_profiles()

    # 3. キューにエンコードタスクを追加する
    # ※ Amatsukazeサーバー(コンテナ等)から参照可能な絶対パスを指定してください
    client.add_queue(
        targets=[{"path": "/host-rootfs/home/user/video.ts", "hash": None}],
        mode="Batch",
        outputs=[{"dstPath": "/tmp", "profile": "QSVEnc-HEVC", "priority": 3}],
    )

    # 4. キューやエンコーダーの一時停止・再開
    client.pause_queue(pause=True, is_queue=False, index=0)  # ワーカー0を一時停止
    client.pause_queue(pause=False, is_queue=True)           # キュー全体を再開

    # 5. キューのアイテムを削除・キャンセル
    client.change_queue(item_id=1, change_type="Cancel")
    client.change_queue(item_id=1, change_type="RemoveItem")
"""



BASE_URL = "http://localhost:32769"
