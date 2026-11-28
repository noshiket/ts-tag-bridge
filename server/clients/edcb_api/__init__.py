"""EDCB(EpgTimer) の Web API の呼び出し。

もとは clients/edcb_api.py の1ファイル。EDCBClient のメソッドを機能ごとの mixin に分けた。"""
from .core import EDCBClient  # noqa: F401
