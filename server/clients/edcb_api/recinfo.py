"""録画済み・プリセット・ストレージ・チューナー・ライブラリ・ロゴ・ログ"""

import re
from typing import Optional


class _RecInfoMixin:
    """EDCBClient の一部（録画済み・プリセット・ストレージ・チューナー・ライブラリ・ロゴ・ログ）。"""

    # -------------------------------------------------------------------------
    # 録画結果
    # -------------------------------------------------------------------------

    def enum_rec_info(
        self,
        id: Optional[str] = None,
        *,
        index: int = 0,
        count: int = 200,
    ) -> list | dict:
        """録画結果一覧取得。id 指定時は該当1件のみ返す"""
        return self._get("EnumRecInfo", {"id": id, "index": index, "count": count})

    def protect_rec_info(self, rec_id: int, protect: bool) -> dict:
        """録画結果のプロテクト設定"""
        ctok = self._get_csrf_token('setrecinfo')
        return self._post("SetRecInfo", params={"id": rec_id}, data={"protect": int(protect), "ctok": ctok})

    def rename_rec_info(self, rec_id: int, new_path: str) -> dict:
        """録画ファイルのリネーム（.program.txt / .err も同時に移動）"""
        ctok = self._get_csrf_token('setrecinfo')
        return self._post("SetRecInfo", params={"id": rec_id}, data={"ren": new_path, "ctok": ctok})

    def del_rec_info(self, rec_id: int) -> dict:
        """録画結果の削除（プロテクト中は不可）"""
        # recinfodesc.html の #del フォームから CsrfToken('recinfo.html') を取得
        page = self.session.get(f"{self.base_url}/EMWUI/recinfodesc.html", params={"id": rec_id})
        page.raise_for_status()
        m = re.search(r'id="del"[^>]*>.*?name="ctok" value="([a-f0-9]{32})"', page.text, re.DOTALL)
        if not m:
            # EDCB に録画が存在しない（すでに削除済み等）→ ノーオペレーション
            return {}
        ctok = m.group(1)
        resp = self.session.post(
            f"{self.base_url}/EMWUI/recinfo.html",
            data={"del": rec_id, "ctok": ctok},
        )
        resp.raise_for_status()
        return {}

    # -------------------------------------------------------------------------
    # プリセット
    # -------------------------------------------------------------------------

    def enum_rec_preset(self) -> list:
        """録画プリセット一覧取得"""
        return self._get("EnumRecPreset")

    # -------------------------------------------------------------------------
    # サーバー状態・制御
    # -------------------------------------------------------------------------

    def get_notify_update_count(self, notify: int) -> dict:
        """更新カウンタ取得。notify=1〜5"""
        return self._get("Common", {"notify": notify})

    def get_storage(self) -> list:
        """録画フォルダのディスク空き容量取得"""
        return self._get("Common", {"storage": 1})

    def get_tuner_status(self) -> list:
        """チューナー稼働状態取得。EnumTunerReserveInfo から導出する。
        Common?tuner=1 (edcb.GetTunerProcessStatusAll) は実行バイナリ未対応のため使用しない。
        """
        return self._get("EnumTunerReserveInfo")

    def epg_cap_now(self) -> dict:
        """EPG取得を即時開始"""
        ctok = self._get_csrf_token('common')
        return self._post("Common", data={"epgcap": 1, "ctok": ctok})

    def reload_epg(self) -> dict:
        """EPGデータの再読み込み"""
        ctok = self._get_csrf_token('common')
        return self._post("Common", data={"epgreload": 1, "ctok": ctok})

    # -------------------------------------------------------------------------
    # ライブラリ
    # -------------------------------------------------------------------------

    def get_library(
        self,
        index: Optional[int] = None,
        dir_hash: Optional[str] = None,
        parent_hashes: Optional[list] = None,
        file_hash: Optional[str] = None,
        basic: int = 1,
    ) -> dict:
        """メディアライブラリ一覧取得。
        index 省略でホーム一覧、index+dir_hash でサブフォルダ、file_hash で単体ファイル情報
        """
        params = {"i": index, "d": dir_hash, "h": file_hash, "basic": basic}
        if parent_hashes:
            params["p"] = parent_hashes
        return self._get("Library", params)

    # -------------------------------------------------------------------------
    # ユーティリティ
    # -------------------------------------------------------------------------

    def get_logo(self, onid: int, sid: int) -> bytes:
        """局ロゴ画像取得。PNG/BMP を返す。見つからない場合は1x1透明GIF

        ロゴが取得できない場合の確認事項:
        1. SaveLogoTypeFlags=63 になっているか
           デフォルト(32=type5のみ)だと多くの局のロゴが取得されない。
           EDCB Web UI: 設定/録画アプリ(EpgDataCap_Bon) →「保存するロゴのタイプ」= 63
           EpgDataCap_Bon.ini: SaveLogoTypeFlags=63

        2. BS/CSのロゴが取得できない場合
           地デジは各局が自局の CDT を送信するが、BS/CS は特定の1サービスから
           全局分のロゴを一括配信する仕組み。フルEPG収集（基本情報のみ=OFF）時に
           CDT が受信・保存される。以下の2箇所を設定すること。

           (A) 定期EPG収集スケジュール ← 最重要・これが抜けるとロゴが保存されない
               EDCB Web UI: 設定/EPG取得開始時間 → 少なくとも1スロットで
               「基本情報のみ取得するネットワーク」の BS・CS1・CS2・CS3 をすべてオフ。
               EpgTimerSrv.ini: [EPG_CAP] の対象スロットの BasicOnlyFlags=0
               ※ BasicOnlyFlags=-1 や 7 はBS/CSがbasic onlyになりロゴが保存されない。

           (B) バックグラウンド収集（視聴・録画中の空きチューナーでの収集）
               EDCB Web UI: 設定/EPG取得 →「基本情報のみ取得するネットワーク（視聴・録画中）」
               BS・CS1・CS2・CS3 をすべてオフ。
               EpgDataCap_Bon.ini: EpgCapBackBSBasicOnly=0
                                   EpgCapBackCS1BasicOnly=0
                                   EpgCapBackCS2BasicOnly=0
                                   EpgCapBackCS3BasicOnly=0

           設定変更後、(A)のスロット時刻にEPG取得を実行し、
           Setting/LogoData/ に 0004_*.png (BS) や 0006_*.png (CS) が
           保存されることを確認する。
        """
        resp = self.session.get(f"{self.base_url}/api/logo", params={"onid": onid, "sid": sid})
        resp.raise_for_status()
        return resp.content

    def get_showlog(
        self,
        *,
        debug: bool = False,
        log_index: Optional[int] = None,
        max_chars: Optional[int] = None,
    ) -> str:
        """EpgTimerSrvログ取得。
        debug=False: EpgTimerSrvNotify.log (SHOW_NOTIFY_LOG 設定が必要)
        debug=True:  EpgTimerSrvDebugLog.txt (SHOW_DEBUG_LOG 設定が必要)
        log_index: debug=True 時に EpgDataCap_Bon_DebugLog-N.txt を指定
        max_chars: 末尾から取得する最大文字数
        """
        params = {}
        if debug:
            params["t"] = "d"
            if log_index is not None:
                params["i"] = log_index
        if max_chars is not None:
            params["c"] = max_chars
        resp = self.session.get(f"{self.base_url}/api/showlog", params=params)
        if resp.status_code == 404:
            raise PermissionError(
                "ログファイルが見つからないか、設定で無効化されています "
                "(Setting/HttpPublic.ini の SHOW_NOTIFY_LOG / SHOW_DEBUG_LOG)"
            )
        resp.raise_for_status()
        return resp.text
