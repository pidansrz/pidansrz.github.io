#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
原生分辨率并排图：把「对齐后的原生裁剪区域」与「裁剪图本体」并排输出，
供最终判定。

映射关系（与 find-crop-dups 一致）：
  f = 裁剪块占容器图宽度的比例；pos/wh 取自归一化空间（模板宽 20）。
  归一化空间：模板宽 20、容器宽 wh[0]；原生容器宽 Bw。
    x_native = pos[0] * Bw / wh[0]
    crop_w   = f * Bw,  crop_h = crop_w * Ch / Cw

用法：python tools/native-crop-pair.py 5 6 13 16 74
"""
import importlib.util
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("cd", "tools/find-crop-dups.py")
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

OUT = "tools/_crop-preview"
MAXW = 640


def scroll(path, width):
    im = Image.open(path)
    im.load()
    if im.mode != "L":
        im = im.convert("L")
    if im.width > width:
        h = max(4, round(im.height * width / im.width))
        im = im.resize((width, h), Image.LANCZOS)
    return im


def task(arg):
    idx, row, fwin = arg
    tpl_path, big_path = (row["a"], row["b"]) if row["dir"] == "a-in-b" else (row["b"], row["a"])
    # 用 diff 工具给出的更准的 f（若没有就用粗筛 f）
    f = fwin or row["scale"]
    Cw, Ch = Image.open(tpl_path).size
    Bw, Bh = Image.open(big_path).size
    x = row["pos"][0] * Bw / float(row["wh"][0])
    y = row["pos"][1] * Bw / float(row["wh"][0])
    cw = f * Bw
    ch = cw * Ch / float(Cw)
    # 稍微外扩几个像素，便于肉眼判断边缘对齐
    pad = 0.02 * Bw
    box = (max(0, int(x - pad)), max(0, int(y - pad)),
           min(Bw, int(x + cw + pad)), min(Bh, int(y + ch + pad)))
    region = Image.open(big_path).convert("L").crop(box)
    # 裁剪图按同宽缩放，便于并排比较
    W = min(MAXW, region.width)
    tpl = scroll(tpl_path, W)
    reg = region if region.width <= W else region.resize((W, max(1, round(region.height * W / region.width))), Image.LANCZOS)
    H = max(tpl.height, reg.height)
    sheet = Image.new("RGB", (tpl.width + reg.width + 24, H + 34), (250, 250, 250))
    sheet.paste(reg.convert("RGB"), (0, 30))
    sheet.paste(tpl.convert("RGB"), (reg.width + 20, 30))
    d = ImageDraw.Draw(sheet)
    d.text((2, 2), "#%d f=%.3f  %s" % (idx, f, row["id"][:60]), fill=(0, 0, 90))
    d.text((2, 15), "左=容器图里的对应区域(%dx%d)  右=裁剪图本体(%dx%d)  %s" % (
        reg.width, reg.height, tpl.width, tpl.height,
        row["a"].split("/")[-1] + " | " + row["b"].split("/")[-1]), fill=(0, 0, 90))
    p = os.path.join(OUT, "nat-%03d.png" % idx)
    sheet.save(p)
    return idx, p


if __name__ == "__main__":
    rows = json.load(open("tools/_crop-dup-report.json", encoding="utf-8"))
    rows.sort(key=lambda r: r["nc"])
    fwin = {}
    if os.path.exists("tools/_crop-diff.json"):
        for r in json.load(open("tools/_crop-diff.json", encoding="utf-8")):
            fwin[r["idx"]] = r.get("f")
    want = [int(x) for x in sys.argv[1:]]
    jobs = [(i, rows[i - 1], fwin.get(i)) for i in want]
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor(max_workers=4) as ex:
        for idx, p in ex.map(task, jobs):
            print("#%d -> %s" % (idx, p))
