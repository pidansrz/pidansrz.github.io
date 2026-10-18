#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
第三道核对：在较高分辨率下、围绕前两级给出的对齐位置做局部搜索，
给出 nativeCorr。真正的「同一张照片被裁过」在原分辨率下相关系数极高
（通常 >= 0.98）；而「同题材但确实是两张不同照片」会明显掉下来。

读 tools/_crop-dup-report.json，就地补写 nc 字段。
"""
import importlib.util
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("cd", "tools/find-crop-dups.py")
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

N = 200          # 复核空间里模板的宽度
R = 10           # 位置邻域半径


def one(row):
    a, b = row["a"], row["b"]
    tpl_path, big_path = (a, b) if row["dir"] == "a-in-b" else (b, a)
    tpl = cd.load_gray(tpl_path, N)
    if tpl is None:
        return dict(row, nc=None)
    ts = cd.stats(tpl)
    best = -2.0
    for ff in (row["scale"] - 0.04, row["scale"], row["scale"] + 0.04):
        if not (0.2 <= ff <= 1.0):
            continue
        bw = int(round(N / ff))
        big = cd.load_gray(big_path, bw)
        if big is None:
            continue
        k = bw / row["wh"][0]
        px, py = int(round(row["pos"][0] * k)), int(round(row["pos"][1] * k))
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                x, y = px + dx, py + dy
                if x < 0 or y < 0 or x + tpl.width > big.width or y + tpl.height > big.height:
                    continue
                c = cd.corr(big.crop((x, y, x + tpl.width, y + tpl.height)), tpl, ts)
                if c > best:
                    best = c
    return dict(row, nc=round(best, 4))


if __name__ == "__main__":
    rows = json.load(open("tools/_crop-dup-report.json", encoding="utf-8"))
    print("核对 %d 对 ..." % len(rows))
    out = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for i, r in enumerate(ex.map(one, rows, chunksize=1), 1):
            out.append(r)
            if i % 20 == 0:
                print("  ... %d/%d" % (i, len(rows)))
    out.sort(key=lambda r: -(r.get("nc") or -1))
    json.dump(out, open("tools/_crop-dup-report.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    import collections
    b = collections.Counter()
    for r in out:
        c = r.get("nc") or -1
        b[">=0.99" if c >= 0.99 else (">=0.98" if c >= 0.98 else
                                      (">=0.96" if c >= 0.96 else "<0.96"))] += 1
    print("nativeCorr 分布:", dict(b))
    for r in out:
        print("  nc=%-8s fine=%-7s %-44s %s <- %s" % (
            r.get("nc"), r.get("fineCorr"), r["id"][:44],
            r["a"].split("/")[-1], r["b"].split("/")[-1]))
