#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
扫描全站：找出「文章头图(cover) 与 正文里的某张配图 是同一画面」的重复情况。

背景：
  公众号文章导入时，封面图被单独下载成 cover.jpg，同时正文 HTML 里的图也被
  下载成 img_XX.jpg。不少文章的作者是把正文第一张图直接设为封面的，于是同一
  画面被存了两份（常常一份是裁过的横版封面、一份是完整原图），文章页顶部一
  张、正文里又一张，看着就是重复。

判定方法（对「裁剪 + 缩放」都稳健）：
  1) 先把两图都缩到宽 64 的灰度图；
  2) 用较矮的那张在较高的那张里上下滑动（逐像素），取窗口差值的**最小**平均
     绝对差（MAE）——这样即使一张是另一张裁掉上下黑边后的版本，也能对齐到很小；
  3) 再算灰度直方图余弦相似度作为旁证。

用法：
  python tools/find-dup-images.py              # 报告 + 写 tools/_dup-report.json
  python tools/find-dup-images.py --threshold 16
"""
import os
import re
import json
import hashlib
import sys

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

PINK = "\033[95m"
YELLOW = "\033[93m"
DIM = "\033[2m"
RESET = "\033[0m"

W = 64


def load_posts():
    """读取文章索引（由 node tools/export-index.js 导出的 tools/_posts.json）。"""
    p = "tools/_posts.json"
    if not os.path.exists(p):
        sys.exit("缺少 tools/_posts.json，请先运行：node tools/export-index.js")
    return json.load(open(p, encoding="utf-8"))


def body_images(n):
    """读 js/posts/<n>.js，取出正文里所有 <img src=...>，按出现顺序返回。"""
    p = "js/posts/%d.js" % n
    if not os.path.exists(p):
        return []
    s = open(p, encoding="utf-8").read()
    return re.findall(r'<img[^>]*?src=\\?"([^"\\]+)\\?"', s)


def sha1(path):
    try:
        return hashlib.sha1(open(path, "rb").read()).hexdigest()
    except OSError:
        return None


def prep(path):
    """返回 (灰度图, 原始尺寸)；失败返回 (None, None)"""
    try:
        im = Image.open(path)
        im.load()
    except Exception:
        return None, None
    size = im.size
    h = max(8, round(im.height * W / im.width))
    return im.convert("L").resize((W, h), Image.LANCZOS), size


def align_mae(ga, gb):
    """把较矮的图在较高的图里上下滑动，取最小 MAE。"""
    if ga is None or gb is None:
        return None
    if ga.height < gb.height:
        ga, gb = gb, ga
    best = 1e9
    top = ga.height - gb.height
    for off in range(0, top + 1):
        win = ga.crop((0, off, W, off + gb.height))
        st = ImageStat.Stat(ImageChops.difference(win, gb))
        m = sum(st.mean) / len(st.mean)
        if m < best:
            best = m
            if best < 0.5:
                break
    return best


def hist_cos(ga, gb):
    """灰度直方图余弦相似度（0~1）。"""
    if ga is None or gb is None:
        return 0.0
    ha, hb = ga.histogram(), gb.histogram()
    dot = sum(x * y for x, y in zip(ha, hb))
    na = sum(x * x for x in ha) ** 0.5
    nb = sum(x * x for x in hb) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def main():
    thr = 16.0
    if "--threshold" in sys.argv:
        thr = float(sys.argv[sys.argv.index("--threshold") + 1])

    posts = load_posts()
    print("共 %d 篇" % len(posts))

    exact, near, intra = [], [], []
    for p in posts:
        cover = p.get("cover") or ""
        if not cover or not os.path.exists(cover):
            continue
        gc, sc = prep(cover)
        bods = body_images(p["n"])

        # 头图 vs 正文各图
        for src in bods:
            if src == cover or not os.path.exists(src):
                continue
            if sha1(cover) == sha1(src):
                exact.append({"post": p, "dup": src, "why": "字节相同"})
                continue
            gb, sb = prep(src)
            mae = align_mae(gc, gb)
            hc = hist_cos(gc, gb)
            if mae is not None and mae <= thr:
                near.append({"post": p, "dup": src, "mae": round(mae, 2),
                             "hist": round(hc, 3), "coverSize": sc, "dupSize": sb})

        # 正文内部两张图重复
        seen = {}
        for i, src in enumerate(bods):
            if not os.path.exists(src):
                continue
            h = sha1(src)
            if h in seen:
                intra.append({"post": p, "a": bods[seen[h]], "b": src, "why": "字节相同"})
            else:
                seen[h] = i

    print()
    print(PINK + "== A. 头图 与 正文图【字节完全相同】=%d ==" % len(exact) + RESET)
    for r in exact:
        print("   %s  <- %s" % (r["post"]["id"][:46].ljust(46), r["dup"]))
    print()
    print(YELLOW + "== B. 头图 与 正文图【同一画面，尺寸/裁剪不同】=%d ==" % len(near) + RESET)
    for r in sorted(near, key=lambda x: x["mae"]):
        print("   MAE=%5.2f 直方图=%.3f  %s" % (r["mae"], r["hist"], r["post"]["id"][:42].ljust(42)))
        print("        cover %s  vs  %s %s" % (r["coverSize"], r["dup"], r["dupSize"]))
    print()
    print(PINK + "== C. 正文内部重复图 =%d ==" % len(intra) + RESET)
    for r in intra:
        print("   %s  %s == %s" % (r["post"]["id"][:42].ljust(42), r["a"], r["b"]))

    out = {
        "threshold": thr,
        "exact": [{"id": r["post"]["id"], "n": r["post"]["n"], "cover": r["post"]["cover"],
                   "dup": r["dup"], "why": r["why"]} for r in exact],
        "near": [{"id": r["post"]["id"], "n": r["post"]["n"], "cover": r["post"]["cover"],
                  "dup": r["dup"], "mae": r["mae"], "hist": r["hist"],
                  "coverSize": list(r["coverSize"]), "dupSize": list(r["dupSize"])} for r in near],
        "intra": [{"id": r["post"]["id"], "n": r["post"]["n"], "a": r["a"], "b": r["b"]}
                  for r in intra],
    }
    json.dump(out, open("tools/_dup-report.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print()
    print(DIM + "明细已写入 tools/_dup-report.json（阈值 %.1f）" % thr + RESET)


if __name__ == "__main__":
    main()
