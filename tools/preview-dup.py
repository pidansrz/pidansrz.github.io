#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 tools/_dup-report.json 里的候选「头图 vs 正文图」两两拼成对比图，
方便人眼快速确认是不是真的同一画面。

输出：tools/_dup-preview/pXX.jpg（每页 8 对，上=头图 cover，下=正文图）
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

OUT = "tools/_dup-preview"
PER_PAGE = 8
THUMB_W = 300


def strip_decor(items):
    """剔除细长装饰条（高度很矮或宽高比极端）——那些是分割线，不是重复配图。"""
    keep = []
    for r in items:
        w, h = r["dupSize"]
        if h < 120 or w / max(h, 1) > 3.5:
            continue
        keep.append(r)
    return keep


def make_pair(cover, dup, label, row_h):
    a = Image.open(cover).convert("RGB")
    b = Image.open(dup).convert("RGB")
    aw = max(1, round(a.width * row_h / a.height))
    bw = max(1, round(b.width * row_h / b.height))
    a = a.resize((aw, row_h), Image.LANCZOS)
    b = b.resize((bw, row_h), Image.LANCZOS)
    gap = 8
    canvas = Image.new("RGB", (aw + gap + bw, row_h + 18), (245, 245, 245))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (aw + gap, 0))
    d = ImageDraw.Draw(canvas)
    d.text((2, row_h + 4), label, fill=(0, 0, 0))
    d.line([(aw, 0), (aw, row_h)], fill=(255, 0, 0), width=2)
    return canvas


def main():
    rep = json.load(open("tools/_dup-report.json", encoding="utf-8"))
    items = strip_decor(rep["exact"] + rep["near"] if rep.get("near") else rep["exact"])
    items = strip_decor(rep["near"])
    # 保留 original 序号，便于人工核对报告里的行
    items = [dict(r, _idx=i + 1) for i, r in enumerate(items)]
    print("参与目视确认的对数：%d（已剔除装饰条）" % len(items))

    os.makedirs(OUT, exist_ok=True)
    # 不主动删旧文件（同名直接覆盖），避免触发沙箱的批量删除限制

    pages = [items[i:i + PER_PAGE] for i in range(0, len(items), PER_PAGE)]
    for pi, page in enumerate(pages, 1):
        rows = [make_pair(r["cover"], r["dup"], "#%d  %s" % (r["_idx"], r["id"][:34]), 130)
                for r in page]
        wmax = max(r.width for r in rows)
        htot = sum(r.height for r in rows) + 6 * len(rows)
        canvas = Image.new("RGB", (wmax, htot), (255, 255, 255))
        y = 0
        for r in rows:
            canvas.paste(r, (0, y))
            y += r.height + 6
        canvas.save(os.path.join(OUT, "p%02d.jpg" % pi), quality=86)
        print("  → %s/p%02d.jpg  (%d 对)" % (OUT, pi, len(page)))


if __name__ == "__main__":
    main()
