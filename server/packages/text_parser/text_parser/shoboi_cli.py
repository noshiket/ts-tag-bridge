"""しょぼいカレンダーの問い合わせを手で試す（python -m text_parser.shoboi_cli）。"""

from .shoboi_api import *  # noqa: F401,F403
from .shoboi_api import CompleteProgramFinder  # noqa: F401


def main():
    """使用例"""
    
    finder = CompleteProgramFinder()
    
    # 例: 放送異常情報の確認
    print("=" * 80)
    print("放送異常情報の確認: MINATO TV 2025-10-04 24:00")
    print("=" * 80)
    print()
    
    # まず番組情報を取得
    info = finder.get_complete_info(
        sid=23608,  # MINATO TV
        start_time='2025-10-05 00:00:00',  # 24:00 = 翌日の00:00
        time_tolerance_min=5
    )
    
    if info:
        print(f"番組: {info['title']}")
        print(f"PID: {info['pid']}")
        print()
        
        # 放送異常情報を取得
        irregularity_info = finder.get_broadcast_irregularity_info(info['pid'])
        
        if irregularity_info:
            print("【放送異常情報】")
            
            if irregularity_info['irregularities']:
                print(f"検出された異常: {', '.join(irregularity_info['irregularities'])}")
            else:
                print("異常なし")
            
            print()
            
            if irregularity_info['has_telop']:
                print(f"✓ テロップあり (種類: {irregularity_info['telop_type']})")
            
            if irregularity_info['has_delay']:
                print(f"✓ 繰り下げあり (理由: {irregularity_info['delay_reason']})")
            
            print()
            print(f"ProgComment: {irregularity_info['prog_comment']}")
            print(f"Flag: {irregularity_info['flag']}")
            print(f"Warn: {irregularity_info['warn']}")
        else:
            print("放送異常情報を取得できませんでした")
    else:
        print("番組が見つかりませんでした")

    finder = CompleteProgramFinder()
    
    # 例1: KT-Z 2021-01-04 10:00
    print("=" * 80)
    print("例1: KT-Z 2021-01-04 10:00-13:00の番組")
    print("=" * 80)
    print()
    
    info1 = finder.get_complete_info(
        sid=333,  # KT-Z
        start_time='2021-01-04 10:00:00',
        time_tolerance_min=5
    )
    
    print()
    print(finder.format_result(info1))
    
    # 例2: MINATO TV 今日 23:30
    print("\n\n")
    print("=" * 80)
    print("例2: MINATO TV 今日 23:30の番組")
    print("=" * 80)
    print()
    
    today = datetime.now().replace(hour=23, minute=30, second=0, microsecond=0)
    
    info2 = finder.get_complete_info(
        service_name='MINATO TV',
        start_time=today.strftime('%Y-%m-%d %H:%M:%S'),
        time_tolerance_min=5
    )
    
    print()
    print(finder.format_result(info2))
    
    # 例3: TIDと話数からエピソード名を取得
    print("\n\n")
    print("=" * 80)
    print("例3: TIDと話数からエピソード名を取得")
    print("=" * 80)
    print()
    
    # 例: ある作品の TID と話数（第16話）
    tid = '6694'
    count = '16'
    
    print(f"TID: {tid}, 話数: 第{count}話")
    episode_info = finder.get_episode_name_by_tid_count(tid, count)
    
    if episode_info:
        print(f"作品: {episode_info['title']}")
        print(f"エピソード名: {episode_info['episode_name']}")
    else:
        print("取得できませんでした")
    
    # 例4: PIDからエピソード名を取得
    print("\n\n")
    print("=" * 80)
    print("例4: PIDからエピソード名を取得")
    print("=" * 80)
    print()
    
    # 涼宮ハルヒの消失 PID=541600
    pid = '541600'
    
    print(f"PID: {pid}")
    episode_info2 = finder.get_episode_name_by_pid(pid)
    
    if episode_info2:
        print(f"作品: {episode_info2['title']}")
        print(f"話数: 第{episode_info2['count']}話" if episode_info2['count'] else "話数なし")
        print(f"エピソード名: {episode_info2['episode_name']}" if episode_info2['episode_name'] else "エピソード名なし（映画など）")
        print(f"放送時間: {episode_info2['start_time']}")
    else:
        print("取得できませんでした")
    # 例5: タイトル名で作品を検索
    print("\n\n")
    print("=" * 80)
    print("例5: タイトル名で作品を検索")
    print("=" * 80)
    print()
    
    keyword = "ポケットフレンズ"
    print(f"検索キーワード: {keyword}")
    
    search_results = finder.search_title_by_keyword(keyword)
    
    if search_results:
        print(f"\n検索結果: {len(search_results)}件")
        for i, result in enumerate(search_results[:5], 1):
            print(f"\n[{i}]")
            print(f"  TID: {result['tid']}")
            print(f"  タイトル: {result['title']}")
            print(f"  略称: {result['short_title']}")
            print(f"  放送開始: {result['first_year']}年{result['first_month']}月")
    else:
        print("検索結果なし")

if __name__ == "__main__":
    main()


# 前回までの規制の期限を読み戻す（再起動しても期限までは問い合わせない）
_load_state()
