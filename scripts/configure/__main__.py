"""config.yml の足りない所を聞いて書く（scripts/setup.sh から呼ぶ）。コメントは残して値だけ書き換える。

  python scripts/configure --config server/config.yml [--encoder QSVEncC] [--edcb-url URL]
         [--amatsukaze-url URL] [--tmp DIR] [--encode-dir DIR ...] [--shoboi-contact URL]

端末につながっていない時（自動で流す時）は聞かずに、指定・今の値・勧める値の順で使う。
最後の行に、選んだエンコーダーを入れる install.sh の指定を出す（setup.sh が読む）。
"""

import argparse
import sys

import gpu
import sections
import yamlio
from ask import say


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--config', required=True)
    p.add_argument('--encoder', choices=list(gpu.ENCODERS))
    p.add_argument('--edcb-url')
    p.add_argument('--amatsukaze-url')
    p.add_argument('--tmp')
    p.add_argument('--encode-dir', action='append')
    p.add_argument('--shoboi-contact')
    a = p.parse_args()

    cfg = yamlio.load(a.config)
    # 見本のまま（EDCB の場所が見本の名前）なら初めての準備
    fresh = 'myserver' in str((cfg.get('edcb_servers') or [{}])[0].get('url', ''))

    # 質問は画面に、最後の1行（install.sh の指定）だけを標準出力に出す
    out, sys.stdout = sys.stdout, sys.stderr
    try:
        say('config.yml の足りない所を聞きます。空で Enter なら [ ] の値を使います')
        enc = sections.encoder(cfg, a.encoder, fresh)
        sections.edcb(cfg, a.edcb_url, fresh)
        sections.amatsukaze(cfg, a.amatsukaze_url, fresh)
        sections.places(cfg, a.tmp, a.encode_dir, fresh)
        sections.shoboi(cfg, a.shoboi_contact)
        yamlio.dump(cfg, a.config)
        say(f'{a.config} に書きました。ほかの項目は、起動した後に設定の画面からも直せます')
    finally:
        sys.stdout = out
    print(gpu.ENCODERS[enc][0])


if __name__ == '__main__':
    main()
