"""
名札の台紙画像を PSD から書き出すスクリプト
==========================================
「名称未設定 1.psd」から、写真と名前のレイヤーを非表示にした台紙
（背景＋「自撮り狂」ロゴのパネル）を「名札_台紙ベース.png」として保存します。

PSDのデザインを変更したら、このスクリプトを再実行して台紙を更新してください。
（写真枠・名前の位置を変えた場合は 名札一括作成.py の座標も合わせて更新）
"""

import os
import sys

from psd_tools import PSDImage

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PSD_PATH = os.path.join(BASE_DIR, "名称未設定 1.psd")
OUTPUT_PATH = os.path.join(BASE_DIR, "名札_台紙ベース.png")

# 台紙から除外するレイヤー（写真＝スマートオブジェクト "IMG..."、名前＝テキストレイヤー）
psd = PSDImage.open(PSD_PATH)
for layer in psd:
    if layer.name.startswith("IMG") or layer.kind == "type":
        layer.visible = False

psd.composite(force=True).save(OUTPUT_PATH)
print(f"保存しました: {OUTPUT_PATH}")
