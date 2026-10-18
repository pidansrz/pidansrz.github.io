#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""针对「相似度处于灰区」的候选对，生成放大对比图，供人眼定夺。
用法：python tools/preview-pairs.py  "coverA|dupA" "coverB|dupB" ...
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

OUT = "tools/_dup-preview/_pairs.jpg"
ROW_H = 260
MAX_W = 400          # 每侧最大宽度，防止超宽图把整页压扁


def _fit(im, row_h, max_w):
    w = max(1, round(im.width * row_h / im.height))
    if w > max_w:
        w = max_w
        row_h = max(1, round(im.height * w / im.width))
    return im.resize((w, row_h), Image.LANCZOS)


def build(pairs):
    rows = []
    for cov, dup, label in pairs:
        a = _fit(Image.open(cov).convert("RGB"), ROW_H, MAX_W)
        b = _fit(Image.open(dup).convert("RGB"), ROW_H, MAX_W)
        aw, ah = a.size
        bw, bh = b.size
        h = max(ah, bh)
        cv = Image.new("RGB", (aw + 8 + bw, h + 20), (250, 250, 250))
        cv.paste(a, (0, 0))
        cv.paste(b, (aw + 8, 0))
        d = ImageDraw.Draw(cv)
        d.text((2, h + 5), "%s  cover=%s  |  %s=%s" % (
            label, a.size, os.path.basename(dup), b.size), fill=(0, 0, 0))
        d.line([(aw, 0), (aw, h)], fill=(255, 0, 0), width=2)
        rows.append(cv)
    wmax = max(r.width for r in rows)
    canvas = Image.new("RGB", (wmax, sum(r.height + 8 for r in rows)), (255, 255, 255))
    y = 0
    for r in rows:
        canvas.paste(r, (0, y))
        y += r.height + 8
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    canvas.save(OUT, quality=88)
    print("已生成", OUT, canvas.size)


if __name__ == "__main__":
    items = []
    for i, arg in enumerate(sys.argv[1:], 1):
        cov, dup = arg.split("|")
        items.append((cov, dup, "#%d" % i))
    build(items)
