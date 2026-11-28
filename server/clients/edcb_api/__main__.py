"""動作確認（python -m clients.edcb_api で単体実行）。"""

from .core import EDCBClient

if __name__ == "__main__":
    client = EDCBClient()

    # -------------------------------------------------------------------------
    # サービス（チャンネル）一覧
    # 各要素: onid, tsid, sid, service_name, remote_control_key_id, network_name 等
    # -------------------------------------------------------------------------
    print("=== サービス一覧（最初の5件）===")
    services = client.enum_service()
    for s in services[:5]:
        print(f"  ch{s['remote_control_key_id']:2} {s['service_name']} ({s['onid']}-{s['tsid']}-{s['sid']})")

    # -------------------------------------------------------------------------
    # 番組表を ProgramInfo として取得
    # fetch_event_info() は self.programs にも追加する
    # id形式: 'ONID-TSID-SID'     → サービスの全番組一覧
    #         'ONID-TSID-SID-EID' → 指定番組1件
    # onair=1 で放送中+次の番組のみ返す
    # -------------------------------------------------------------------------
    print("\n=== 番組表（QZX総合 最初の3件）ProgramInfo ===")
    svc = next((s for s in services if s["service_name"] == "ＱＺＸ総合１・東京"), None)
    if svc:
        sid_str = f"{svc['onid']}-{svc['tsid']}-{svc['sid']}"
        programs = client.fetch_event_info(sid_str, count=3)
        for p in programs:
            print(f"  {p.start_time} ({p.duration_min}分) [{p.service_name}] {p.title}")
            if p.description:
                print(f"    {p.description[:60]}…")

    # -------------------------------------------------------------------------
    # 番組検索を ProgramInfo として取得
    # andkey: ANDキーワード（スペース区切りで複数）
    # network: bit0=地デジ, bit1=BS, bit2=CS (0=全て)
    # -------------------------------------------------------------------------
    print("\n=== 番組検索「ニュース」地デジ 3件 ProgramInfo ===")
    client.programs.clear()
    programs = client.fetch_search_event(andkey="ニュース", network=1, count=3)
    for p in programs:
        print(f"  {p.start_time} [{p.service_name}] {p.title}")

    # -------------------------------------------------------------------------
    # 予約一覧を ProgramInfo として取得
    # raw dict も必要な場合は enum_reserve_info() を使う（reserveID, recSetting 等を含む）
    # -------------------------------------------------------------------------
    print("\n=== 予約一覧（最初の5件）ProgramInfo ===")
    client.programs.clear()
    reserves = client.fetch_reserve_info()
    for p in reserves[:5]:
        print(f"  {p.start_time} ({p.duration_min}分) [{p.service_name}] {p.title}")

    # -------------------------------------------------------------------------
    # print_programs() で共通フォーマット表示（BaseProgramReader のメソッド）
    # -------------------------------------------------------------------------
    print("\n=== print_programs() サンプル（予約最初の2件）===")
    client.programs = reserves[:2]
    client.print_programs()

    # -------------------------------------------------------------------------
    # 予約操作の例（実行するとサーバーに反映されるためコメントアウト）
    #
    # EPGから予約追加（ONID-TSID-SID-EID を指定）
    # result = client.add_reserve("7-16625-304-12345", recMode=1, priority=2, tuijyuuFlag=1)
    # print(result)  # {"success": "予約を追加しました"}
    #
    # 時刻直接指定で予約追加
    # result = client.add_reserve_manual(
    #     startdate="2026-04-25", starttime="20:00:00", endtime="21:00:00",
    #     service="7-16625-304", title="テスト録画", recMode=1, priority=2,
    # )
    #
    # 予約変更（変えたい項目のみ指定）
    # result = client.change_reserve(1908, priority=3)
    #
    # 予約削除
    # result = client.del_reserve(1908)
    # print(result)  # {"success": "予約を削除しました"}
    # -------------------------------------------------------------------------

    # -------------------------------------------------------------------------
    # 録画結果一覧（raw dict）
    # 各要素: id, title, startTime, recFilePath, drops, scrambles, protectFlag 等
    # -------------------------------------------------------------------------
    print("\n=== 録画結果（最新3件）===")
    for r in client.enum_rec_info(count=3):
        print(f"  [{r['id']}] {r['startTime']} {r['title']}")

    # -------------------------------------------------------------------------
    # 録画プリセット一覧（raw dict）
    # 各要素: id, name, recsetting
    # -------------------------------------------------------------------------
    print("\n=== 録画プリセット ===")
    for p in client.enum_rec_preset():
        print(f"  [{p['id']}] {p['name']}")

    # -------------------------------------------------------------------------
    # ストレージ空き容量
    # 各要素: name(パス), text(人間向け表示), free, total, avail
    # -------------------------------------------------------------------------
    print("\n=== ストレージ ===")
    for s in client.get_storage():
        print(f"  {s['name']} {s['text']}")
