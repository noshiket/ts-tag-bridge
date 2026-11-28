"""動作確認（python -m clients.amatsukaze_api で単体実行）。"""

from .core import AmatsukazeClient


def main():
    client = AmatsukazeClient()

    # -------------------------------------------------------------------------
    # システム状態
    # -------------------------------------------------------------------------
    print("=== システム状態 ===")
    try:
        system = client.get_system()
        print(system)
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # サービス一覧（チャンネル）
    # -------------------------------------------------------------------------
    print("\n=== サービス一覧（最初の5件）===")
    try:
        services = client.get_services()
        for s in services[:5]:
            print(f"  [{s.get('serviceId', '?')}] {s.get('serviceName', '?')}")
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # プロファイル一覧
    # -------------------------------------------------------------------------
    print("\n=== プロファイル一覧 ===")
    try:
        profiles = client.get_profiles()
        for p in profiles:
            name = p.get("name", "?") if isinstance(p, dict) else str(p)
            print(f"  {name}")
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # キュー一覧
    # -------------------------------------------------------------------------
    print("\n=== キュー（全件）===")
    try:
        queue = client.get_queue()
        items = queue.get("items", []) if isinstance(queue, dict) else []
        print(f"  合計 {len(items)} 件")
        for item in items[:5]:
            print(
                f"  [{item.get('id', '?')}] {item.get('state', '?'):10s} "
                f"{item.get('srcPath', '?')}"
            )
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # エンコードログ（ページング、最新3件）
    # -------------------------------------------------------------------------
    print("\n=== エンコードログ（最新3件）===")
    try:
        page = client.get_encode_logs_page(offset=0, limit=3)
        total = page.get("total", 0)
        print(f"  総件数: {total}")
        for log in page.get("items", []):
            print(
                f"  {log.get('encodeStart', '?')} "
                f"{log.get('srcPath', '?')}"
            )
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # パスサジェスト
    # -------------------------------------------------------------------------
    print("\n=== パスサジェスト（/） ===")
    try:
        suggest = client.get_path_suggest("/", max_dirs=5, max_files=0, allow_files=False)
        for d in suggest.get("dirs", []):
            print(f"  {d.get('fullPath', '?')}")
    except Exception as e:
        print(f"  エラー: {e}")

    # -------------------------------------------------------------------------
    # キューへの追加例（コメントアウト / 実行するとサーバーに反映される）
    #
    # result = client.add_queue(
    #     targets=[{"path": "/recorded/番組名.ts", "hash": None}],
    #     mode="Batch",
    #     outputs=[{"dstPath": "/encoded/", "profile": "デフォルト", "priority": 3}],
    # )
    # print(result)  # { "requestId": "..." }
    #
    # # キャンセル
    # client.change_queue(item_id=1, change_type="Cancel")
    #
    # # 優先度変更
    # client.change_queue(item_id=1, change_type="Priority", priority=5)
    # -------------------------------------------------------------------------


if __name__ == "__main__":
    main()
