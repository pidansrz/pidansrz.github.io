#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 find-crop-dups.py 的候选对拼成对照图，供人工目视确认。

输出：tools/_crop-preview/sheet-XX.png
每行一对：左 = a，右 = b，两侧下方标注文件名、相关系数、方向、尺度。
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

OUT = "tools/_crop-preview"
TH = 120          # 单图最大高度
MAXW = 380        # 单图最大宽度
COLS = 6          # 每张对照图放几对
LABEL_H = 30


def load(path, maxh, maxw):
    try:
        im = Image.open(path)
        im.load()
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
    except Exception:
        return Image.new("RGB", (maxw, maxh), (200, 200, 200))
    k = min(maxh / im.height, maxw / im.width, 1.0)
    if k < 1:
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    return im.convert("RGB")


def main():
    rep = json.load(open("tools/_crop-dup-report.json", encoding="utf-8"))
    rows = [r for r in rep if r.get("nc") is not None]
    rows.sort(key=lambda r: r["nc"])
    print("纳入对照：%d 对" % len(rows))
    os.makedirs(OUT, exist_ok=True)

    cells = []
    for i, r in enumerate(rows, 1):
        a = load(r["a"], TH, MAXW)
        b = load(r["b"], TH, MAXW)
        w = a.width + b.width + 24
        cell = Image.new("RGB", (w, TH + LABEL_H), (255, 255, 255))
        cell.paste(a, (0, 0))
        cell.paste(b, (a.width + 24, 0))
        d = ImageDraw.Draw(cell)
        d.rectangle([a.width + 10, 0, a.width + 14, TH], fill=(220, 60, 60))
        # dir=a-in-b 表示 a 是 b 的裁剪 → 保留 b、删 a
        keep = r["b"] if r["dir"] == "a-in-b" else r["a"]
        lab = "#%d nc=%s fine=%s f=%s\n%s\n\"%s\" | \"%s\"  keep=%s" % (
            i, r.get("nc"), r.get("fineCorr"), r.get("fineScale"),
            r["id"][:52],
            r["a"].split("/")[-1], r["b"].split("/")[-1], keep.split("/")[-1])
        d.multiline_text((0, TH + 2), lab, fill=(0, 0, 0))
        cells.append((i, r, cell))

    # 按 COLS 列分页
    for page in range(0, len(cells), COLS):
        chunk = cells[page:page + COLS]
        W = max(c[2].width for c in chunk) + 20
        H = sum(c[2].height for c in chunk) + 20
        sheet = Image.new("RGB", (W, H), (245, 245, 245))
        y = 10
        for _, _, cell in chunk:
            sheet.paste(cell, (10, y))
            y += cell.height + 6
        p = os.path.join(OUT, "sheet-%02d.png" % (page // COLS + 1))
        sheet.save(p)
        print("  写出 %s  (%d 对)" % (p, len(chunk)))


if __name__ == "__main__":
    main()
