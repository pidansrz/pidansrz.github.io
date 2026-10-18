#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
对某一对图做「对齐 + 出差分图」，用于人眼最终判定是不是同一张画面。

读取 tools/_crop-dup-report.json 里的 (dir, scale, pos, wh) 作为初值，
在更高分辨率下做小范围精调（尺度 + 位置），输出三格对照：
   [裁剪图] | [在另一张里对齐后的窗口] | [差分图（放大 3 倍）]
差分图接近全黑 => 同一张画面。

用法：
  python tools/diff-crop-pair.py 3 5 6 16 41 43 56 81 92
"""
import importlib.util
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("cd", "tools/find-crop-dups.py")
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

OUT = "tools/_crop-preview"


def norm(path, width):
    return cd.load_gray(path, width)


def best_window(tpl_path, big_path, f0, pos0, wh0, N):
    """返回 (bestCorr, bestDiffMAE, window, f, xy)"""
    tpl = norm(tpl_path, N)
    if tpl is None:
        return None
    ts = cd.stats(tpl)
    best = None
    for f in (f0 - 0.06, f0 - 0.04, f0 - 0.02, f0, f0 + 0.02, f0 + 0.04, f0 + 0.06):
        if not (0.2 <= f <= 1.0):
            continue
        bw = int(round(N / f))
        if bw < tpl.width:
            continue
        big = norm(big_path, bw)
        if big is None or big.height < tpl.height or big.width < tpl.width:
            continue
        k = bw / float(wh0)
        px, py = int(round(pos0[0] * k)), int(round(pos0[1] * k))
        rx, ry = N // 5, N // 5
        for y in range(max(0, py - ry), min(big.height - tpl.height, py + ry) + 1):
            for x in range(max(0, px - rx), min(big.width - tpl.width, px + rx) + 1):
                win = big.crop((x, y, x + tpl.width, y + tpl.height))
                c = cd.corr(win, tpl, ts)
                if c < 0:
                    continue
                mae = cd.ImageStat.Stat(cd.ImageChops.difference(win, tpl)).mean[0]
                if best is None or mae < best[1]:
                    best = (c, mae, win, f, (x, y))
    return (tpl, best) if best else (tpl, None)


def task(arg):
    idx, row = arg
    tpl_path, big_path = (row["a"], row["b"]) if row["dir"] == "a-in-b" else (row["b"], row["a"])
    f0 = row["scale"]
    N = int(max(80, min(260, 600 * f0)))
    tpl, best = best_window(tpl_path, big_path, f0, row["pos"], row["wh"][0], N)
    if best is None:
        return idx, None, None
    c, mae, win, f, xy = best
    diff = ImageChops.difference(win, tpl).point(lambda v: min(255, v * 3))
    W = tpl.width + win.width + diff.width + 30
    H = max(tpl.height, win.height) + 44
    sheet = Image.new("RGB", (W, H), (250, 250, 250))
    x = 0
    for im in (win, tpl, diff):
        sheet.paste(im.convert("RGB"), (x, 30))
        ImageDraw.Draw(sheet).text((x + 2, 4), ["在另一张中", "裁剪图", "差分 x3"][
            (win, tpl, diff).index(im)], fill=(0, 0, 0))
        x += im.width + 15
    lab = "#%d ncOld=%s -> corr=%.4f MAE=%.2f f=%.3f %s  %s | %s" % (
        idx, row.get("nc"), c, mae, f,
        row["id"][:40], row["a"].split("/")[-1], row["b"].split("/")[-1])
    ImageDraw.Draw(sheet).text((2, 16), lab, fill=(0, 0, 90))
    p = os.path.join(OUT, "diff-%03d.png" % idx)
    sheet.save(p)
    return idx, c, mae, f, xy


if __name__ == "__main__":
    rows = json.load(open("tools/_crop-dup-report.json", encoding="utf-8"))
    rows.sort(key=lambda r: r["nc"])
    want = [int(x) for x in sys.argv[1:]] or list(range(1, len(rows) + 1))
    jobs = [(i, rows[i - 1]) for i in want]
    os.makedirs(OUT, exist_ok=True)
    res = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for idx, c, mae, f, xy in ex.map(task, jobs, chunksize=1):
            res.append((idx, c, mae, f, xy))
            print("#%-3d corr=%-8s MAE=%-8s f=%.3f pos=%s" % (idx, c, mae, f, xy))
    json.dump([{"idx": i, "corr": c, "mae": m, "f": f, "pos": list(p)}
               for i, c, m, f, p in res],
              open("tools/_crop-diff.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
