"""python -m text_parser で動かす、パターン解析の手動の確かめ。"""

import json

from .parser.core import TextParser


def main():
    import tempfile
    import os

    # 新形式の設定（switch/list/analyze構造 + pattern_index）
    sample_config = {
        "analyzers": [
            {
                "pattern": "アニメ「{$1}」 #{$2}「{$3}」",
                "pattern_index": 0,
                "analyze": [
                    {
                        "switch": "{$1}",
                        "list": [
                            {
                                "str": "星屑カフェの日常!",
                                "analyze": [
                                    {
                                        "setStr": "title",
                                        "str": "星屑カフェの日常!"
                                    },
                                    {
                                        "setStr": "subtitle",
                                        "str": "{$3}"
                                    },
                                    {
                                        "setNum": "episode",
                                        "str": "{$2}"
                                    }
                                ]
                            },
                            {
                                "str": "月影ノ書",
                                "analyze": [
                                    {
                                        "setStr": "title",
                                        "str": "月影ノ書"
                                    },
                                    {
                                        "setStr": "subtitle",
                                        "str": "{$3}"
                                    },
                                    {
                                        "setNum": "episode",
                                        "str": "{$2}"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                "pattern": "【{$1}】第{$2}話 {$3}",
                "pattern_index": 1,
                "analyze": [
                    {
                        "switch": "{$1}",
                        "list": [
                            {
                                "str": "ドラマ",
                                "analyze": [
                                    {
                                        "setStr": "category",
                                        "str": "ドラマ"
                                    },
                                    {
                                        "setNum": "episode",
                                        "str": "{$2}"
                                    },
                                    {
                                        "setStr": "subtitle",
                                        "str": "{$3}"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                "pattern": "映画『{$1}』",
                "pattern_index": 2,
                "analyze": [
                    {
                        "switch": "{$1}",
                        "list": [
                            {
                                "str": "グランドシップ",
                                "analyze": [
                                    {
                                        "setStr": "title",
                                        "str": "グランドシップ"
                                    },
                                    {
                                        "setStr": "type",
                                        "str": "movie"
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                
                "pattern": "{$1} #{$2}",
                "analyze": [
                    {
                    "switch": "{$1}",
                    "list": [
                        {
                        "str": "魔法使いの旅路",
                        "analyze": [
                            {
                            "setStr": "title",
                            "str": "魔法使いの旅路"
                            },
                            {
                            "setNum": "episode",
                            "str": "{$2}"
                            },
                            {
                            "pattern": "#{$1}「{$2}」{$3}", 
                            "text": "$new_text",
                            "analyze": [
                                {
                                "setStr": "subtitle",
                                "str": "{$2}" 
                                }
                            ]
                            }
                        ]
                        }
                    ]
                    }
                ]
                    
            }
        ]
    }

    # 一時ファイルに設定を保存
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(sample_config, f, ensure_ascii=False, indent=2)
        config_path = f.name

    try:
        parser = TextParser(config_path)

        print("=== 新形式のテスト（switch/list/analyze構造 + pattern_index） ===\n")

        test_cases = [
            "アニメ「星屑カフェの日常!」 #11「初めてのバーベキュー」",
            "アニメ「月影ノ書」 #1「はじまり」",
            "アニメ「月影ノ書」 #23「最終回」",
        ]

        for text in test_cases:
            result = parser.parse_text(text)
            print(f"入力: {text}")
            print(f"結果: {result}")
            if result:
                print("  詳細:")
                for key, value in result.items():
                    print(f"    {key}: {value} (type: {type(value).__name__})")
            print()

        print("\n=== check_matching_patterns のテスト ===\n")
        
        test_text = "アニメ「星屑カフェの日常!」 #11「初めてのバーベキュー」"
        print(f"入力: {test_text}\n")
        
        matching_patterns = parser.check_matching_patterns(test_text)
        print(f"一致したパターン数: {len(matching_patterns)}\n")
        
        for i, pattern_info in enumerate(matching_patterns):
            print(f"パターン {i + 1}:")
            print(f"  analyzer_index: {pattern_info['analyzer_index']}")
            if 'pattern_index' in pattern_info:
                print(f"  pattern_index: {pattern_info['pattern_index']}")
            print(f"  pattern: {pattern_info['pattern']}")
            print(f"  マッチしたグループ:")
            for group_name, value in pattern_info['matched_groups'].items():
                print(f"    {group_name}: {value}")
            print(f"  解析結果: {pattern_info['parse_result']}")
            print()

        print("\n=== find_patterns_by_string のテスト（新機能） ===\n")
        
        # テストケース1: 設定にない新しいテキスト
        test_text = "アニメ「森の調律師」 #1「出会い」"
        print(f"入力: {test_text}")
        print("（このテキストは設定に定義されていないが、既存パターンに適用可能か確認）\n")
        
        found_patterns = parser.find_patterns_by_string(test_text)
        print(f"マッチ可能なパターン数: {len(found_patterns)}\n")
        
        for i, pattern_info in enumerate(found_patterns):
            print(f"パターン {i + 1}:")
            print(f"  analyzer_index: {pattern_info['analyzer_index']}")
            if 'pattern_index' in pattern_info:
                print(f"  pattern_index: {pattern_info['pattern_index']}")
            print(f"  pattern: {pattern_info['pattern']}")
            print(f"  マッチしたグループ:")
            for group_name, value in pattern_info['matched_groups'].items():
                print(f"    {group_name}: {value}")
            print(f"  can_parse (解析可能): {pattern_info['can_parse']}")
            if 'parse_result' in pattern_info:
                print(f"  parse_result: {pattern_info['parse_result']}")
            else:
                print(f"  parse_result: パターンは合致するが、switch条件（{pattern_info['matched_groups']['g1']}）が設定にないため解析不可")
            print()
        
        # テストケース2: 別の新しいテキスト
        test_text = "【ドラマ】第5話 最終決戦"
        print(f"入力: {test_text}\n")
        
        found_patterns = parser.find_patterns_by_string(test_text)
        print(f"マッチ可能なパターン数: {len(found_patterns)}\n")
        
        for i, pattern_info in enumerate(found_patterns):
            print(f"パターン {i + 1}:")
            print(f"  analyzer_index: {pattern_info['analyzer_index']}")
            if 'pattern_index' in pattern_info:
                print(f"  pattern_index: {pattern_info['pattern_index']}")
            print(f"  pattern: {pattern_info['pattern']}")
            print(f"  can_parse: {pattern_info['can_parse']}")
            if 'parse_result' in pattern_info:
                print(f"  parse_result: {pattern_info['parse_result']}")
            print()
        
        # テストケース: 架空戦記ミナト（サブタイトル付き複数話）
        print("\n=== サブタイトル付き複数話のテスト ===\n")
        jujutsu_config = {
            "analyzers": [
                {
                    "pattern": "{$1} #{$2}【決戦編 前編】",
                    "analyze": [
                        {
                            "switch": "{$1}",
                            "list": [
                                {
                                    "str": "『架空戦記ミナト』第3期",
                                    "analyze": [
                                        {"setStr": "folder", "str": "架空戦記ミナト"},
                                        {"setStr": "title", "str": "架空戦記ミナト(3)"},
                                        {"setNum": "episode", "str": "{$2}"}
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f2:
            json.dump(jujutsu_config, f2, ensure_ascii=False, indent=2)
            jujutsu_config_path = f2.name
        try:
            jujutsu_parser = TextParser(jujutsu_config_path)
            jujutsu_tests = [
                "『架空戦記ミナト』第3期 #48「開戦」,#49「再会」【決戦編 前編】",
                "『架空戦記ミナト』第3期 #50「最終回」【決戦編 前編】",
            ]
            for text in jujutsu_tests:
                result = jujutsu_parser.parse_text(text)
                print(f"入力: {text}")
                print(f"結果: {result}")
                if result:
                    for key, value in result.items():
                        print(f"  {key}: {value!r}")
                print()
        finally:
            os.unlink(jujutsu_config_path)

        # テストケース: setSubtitles
        print("\n=== setSubtitles のテスト ===\n")
        subtitles_config = {
            "analyzers": [
                {
                    "pattern": "{$1} {$2}",
                    "analyze": [
                        {
                            "switch": "{$1}",
                            "list": [
                                {
                                    "str": "SPACE ROAD",
                                    "analyze": [
                                        {"setStr": "title", "str": "ギャラクシー・バトル"},
                                        {"setSubtitles": "subtitle", "str": "{$2}"}
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f3:
            json.dump(subtitles_config, f3, ensure_ascii=False)
            sub_config_path = f3.name
        try:
            sub_parser = TextParser(sub_config_path)
            sub_tests = [
                "SPACE ROAD 01 SKY STORM#02 OCEAN RUN#03 IRON PLANT#04 LONG WAY",
                "SPACE ROAD 1.春の嵐#2.夏の海#3.秋の風",
                "SPACE ROAD NO PREFIX#ALSO NO PREFIX",
                "SPACE ROAD #01 SKY STORM\n#02 OCEAN RUN\n#03 IRON PLANT\n#04 LONG WAY",
                "SPACE ROAD 01 SKY STORM\n02 OCEAN RUN\n03 IRON PLANT",
            ]
            for text in sub_tests:
                result = sub_parser.parse_text(text)
                print(f"入力: {text!r}")
                print(f"結果: {result}")
                print()
        finally:
            os.unlink(sub_config_path)

        # patternタイプのネスト内でsetSubtitlesを使うテスト
        print("\n=== pattern内setSubtitlesのテスト ===\n")
        gal_config = {
            "analyzers": [
                {
                    "pattern": "{$1} #{$2}",
                    "analyze": [
                        {
                            "switch": "{$1}",
                            "list": [
                                {
                                    "str": "ギアフォース THE REVOLUTION",
                                    "analyze": [
                                        {"setStr": "folder", "str": "ギアフォース"},
                                        {"setStr": "title", "str": "{$1}"},
                                        {"setNum": "episode", "str": "{$2}"},
                                        {
                                            "pattern": "#{$1}\n【全4話】1996-1997年OVA",
                                            "text": "$description",
                                            "analyze": [
                                                {"setSubtitles": "subtitle", "str": "{$1}"}
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f4:
            json.dump(gal_config, f4, ensure_ascii=False)
            gal_path = f4.name
        try:
            gal_parser = TextParser(gal_path)
            desc = "#01 SKY STORM\n#02 OCEAN RUN\n#03 IRON PLANT\n#04 LONG WAY\n【全4話】1996-1997年OVA"
            context = {"description": desc}
            result = gal_parser.parse_text("ギアフォース THE REVOLUTION #1~4", context)
            print(f"結果: {result}")
        finally:
            os.unlink(gal_path)

        # テストケース3: 別の新しいテキスト
        test_text = "魔法使いの旅路 #3"
        context = {"new_text": "#3「決意」"}
        print(f"入力: {test_text}\n")
        print(f"入力: {context}\n")

        result = parser.parse_text(test_text, context)
        print(result)
        # 結果: {'title': '魔法使いの旅路', 'episode': 3, 'subtitle': '決意'}

    finally:
        os.unlink(config_path)


if __name__ == "__main__":
    main()
