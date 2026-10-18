#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
全站扫描：找出「同一张照片被存了两份，其中一份是另一份的裁剪（且可能被缩放）」。

与 find-dup-images.py 的区别：
  find-dup-images.py 只做「等比缩放 + 上下平移」对齐，能抓「同一张图只是尺寸
  不同」；但对「封面是从正文图里裁出来的一块」（宽高都被裁、内容位置也偏）会漏掉。
  本脚本做 **多尺度 + 二维平移** 的模板匹配，专门抓这种裁剪关系。

判定方法：
  1) 两图各自转灰度；
  2) 把「较小的一张（裁剪候选）」缩到宽 W 作为模板；把「较大的那张」缩到宽
     W/f（f = 裁剪块占大图宽度的比例，扫一组 f），此时裁剪块在大图里也正好是
     宽 W，于是可用二维平移搜索对齐；
  3) 用**归一化相关系数**（对明暗、对比、色偏都不敏感）打分，取所有位置/尺度/
     方向下的最大值；平坦无纹理的窗口直接判为无效，避免乱配。

用法：
  python tools/find-crop-dups.py                  # 粗筛（记录全部得分）
  python tools/find-crop-dups.py --verify         # 再加高分辨率复核
"""
import os
import re
import sys
import json
import time
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

DRAFTS = "drafts"
CACHE = {}

# ---- 参数 ----
W = 20                  # 粗筛空间里模板的宽度
STEP = 2                # 粗筛搜索步长
SCALES = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1.0]
FINE_SCALES = [s / 100.0 for s in range(30, 101, 3)]
MIN_STD = 10.0          # 模板/窗口的标准差下限，太小说明是纯色块，不可比
COARSE_CORR = 0.90      # 粗筛相关系数阈值
FINE_CORR = 0.93        # 复核阈值


def parse_front(s):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", s, re.S)
    if not m:
        return {}, s
    fm = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, s[m.end():]


def body_images(md):
    """按顺序取出正文里的图片（含 ![](...) 与 <img src=...>），去重保序"""
    out = []
    for m in re.finditer(r'!\[[^\]]*\]\(([^)\s]+)', md):
        out.append(m.group(1))
    for m in re.finditer(r'<img[^>]*?src="([^"]+)"', md):
        out.append(m.group(1))
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def load_inventory():
    arts = []
    for fn in sorted(os.listdir(DRAFTS)):
        if not fn.endswith(".md") or fn.startswith("_") or fn.lower() == "readme.md":
            continue
        s = open(os.path.join(DRAFTS, fn), encoding="utf-8").read()
        fm, md = parse_front(s)
        imgs = []
        if fm.get("cover"):
            imgs.append(("cover", fm["cover"]))
        for i, src in enumerate(body_images(md)):
            imgs.append(("body%d" % i, src))
        arts.append({"file": fn, "id": fm.get("id") or fn[:-3], "imgs": imgs})
    return arts


def load_gray(path, width):
    key = (path, width)
    if key in CACHE:
        return CACHE[key]
    try:
        im = Image.open(path)
        im.load()
        if im.mode != "L":
            im = im.convert("L")
        h = max(4, round(im.height * width / im.width))
        v = im.resize((width, h), Image.LANCZOS)
    except Exception:
        v = None
    CACHE[key] = v
    return v


def stats(im):
    st = ImageStat.Stat(im)
    n = im.width * im.height
    return (st.sum[0], st.sum2[0], n)


def corr(win, tpl, tstats):
    """归一化相关系数；任一标准差过小（纯色块）返回 -1"""
    sx, sx2, n = stats(win)
    sy, sy2, tn = tstats
    varx = n * sx2 - sx * sx          # = n^2 * 方差
    vary = tn * sy2 - sy * sy
    if varx <= 0 or vary <= 0:
        return -1.0
    if varx ** 0.5 / n < MIN_STD or vary ** 0.5 / tn < MIN_STD:
        return -1.0
    d = ImageStat.Stat(ImageChops.difference(win, tpl))
    n2 = win.width * win.height
    sxy = (sx2 + sy2 - d.sum2[0]) / 2.0
    num = n2 * sxy - sx * sy
    den = (varx * vary) ** 0.5
    return num / den if den > 1e-9 else -1.0


def best_corr(tpl, tstats, big, step, early=0.9995):
    tw, th = tpl.size
    bw, bh = big.size
    if tw > bw or th > bh:
        return None, None
    best, bpos = -2.0, None
    for y in range(0, bh - th + 1, step):
        for x in range(0, bw - tw + 1, step):
            c = corr(big.crop((x, y, x + tw, y + th)), tpl, tstats)
            if c > best:
                best, bpos = c, (x, y)
                if best >= early:
                    return best, bpos
    return best, bpos


def pair_score(pa, pb, width=W, scales=SCALES, step=STEP):
    """返回全方向/尺度/位置下的最大相关系数"""
    best = {"corr": -2.0, "dir": None, "scale": None, "wh": None, "pos": None}
    for tpl_path, big_path, tag in ((pa, pb, "a-in-b"), (pb, pa, "b-in-a")):
        tpl = load_gray(tpl_path, width)
        if tpl is None:
            continue
        tstats = stats(tpl)
        for f in scales:
            bw = int(round(width / f))
            if bw < width:
                continue
            big = load_gray(big_path, bw)
            if big is None:
                continue
            c, pos = best_corr(tpl, tstats, big, step)
            if c is not None and c > best["corr"]:
                best = {"corr": c, "dir": tag, "scale": f, "wh": big.size, "pos": pos}
    return best


def fine_scales(s0):
    """复核用的尺度：围绕粗筛最优尺度细化，另加几个兜底"""
    out = set([0.5, 0.7, 0.9])
    if s0:
        for k in (-0.12, -0.08, -0.04, -0.02, 0.0, 0.02, 0.04, 0.08, 0.12):
            v = round(s0 + k, 3)
            if 0.25 <= v <= 1.0:
                out.add(v)
    return sorted(out)


def verify_pair(row):
    """对粗筛候选做高分辨率复核"""
    a, b = row["a"], row["b"]
    best = {"corr": -2.0, "dir": None, "scale": None}
    for tpl_path, big_path, tag in ((a, b, "a-in-b"), (b, a, "b-in-a")):
        tpl = load_gray(tpl_path, 64)
        if tpl is None:
            continue
        tstats = stats(tpl)
        for f in fine_scales(row.get("scale")):
            bw = int(round(64 / f))
            if bw < 64:
                continue
            big = load_gray(big_path, bw)
            if big is None:
                continue
            c, pos = best_corr(tpl, tstats, big, 2)
            if c is not None and c > best["corr"]:
                best = {"corr": c, "dir": tag, "scale": f}
    out = dict(row)
    out["fineCorr"] = round(best["corr"], 4)
    out["fineScale"] = best["scale"]
    out["fineDir"] = best["dir"]
    return out


def jobs_for(art):
    imgs = [(k, v) for k, v in art["imgs"] if os.path.exists(v)]
    J = []
    cov = [x for x in imgs if x[0] == "cover"]
    bod = [x for x in imgs if x[0] != "cover"]
    for _, cv in cov:
        for _, bv in bod:
            J.append((cv, bv))
    for i in range(len(bod) - 1):
        J.append((bod[i][1], bod[i + 1][1]))
    return J


def work(args):
    aid, J = args
    out = []
    for a, b in J:
        r = pair_score(a, b)
        out.append({"a": a, "b": b, "corr": round(r["corr"], 4),
                    "dir": r["dir"], "scale": r["scale"],
                    "wh": list(r["wh"]) if r["wh"] else None,
                    "pos": list(r["pos"]) if r["pos"] else None})
    return aid, out


if __name__ == "__main__":
    arts = load_inventory()
    print("文章 %d 篇，图片登记 %d 张" % (len(arts), sum(len(a["imgs"]) for a in arts)))

    if "--one" in sys.argv:
        target = sys.argv[sys.argv.index("--one") + 1]
        for a in arts:
            if target in a["id"]:
                print(a["id"], a["imgs"])
                for pa, pb in jobs_for(a):
                    print("  %.4f  %s <- %s" % (pair_score(pa, pb)["corr"], pa, pb))
        sys.exit(0)

    t0 = time.time()
    todo = [(a["id"], jobs_for(a)) for a in arts]
    print("待比较图片对：%d" % sum(len(j) for _, j in todo))

    results = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for i, (aid, rows) in enumerate(ex.map(work, todo, chunksize=4), 1):
            results.append({"id": aid, "rows": rows})
            if i % 100 == 0:
                print("  ... %d/%d (%.0fs)" % (i, len(todo), time.time() - t0))

    rows_all = [dict(r, id=x["id"]) for x in results for r in x["rows"]]
    rows_all.sort(key=lambda r: -r["corr"])
    with open("tools/_crop-dup-report.json", "w", encoding="utf-8") as fh:
        json.dump(rows_all, fh, ensure_ascii=False, indent=1)
    print("粗筛完成 %.0fs；得分>=%.2f 的对：%d" % (
        time.time() - t0, COARSE_CORR, sum(1 for r in rows_all if r["corr"] >= COARSE_CORR)))

    if "--verify" in sys.argv:
        cand = [r for r in rows_all if r["corr"] >= COARSE_CORR]
        print("\n高分辨率复核 %d 对（宽 64，并行）..." % len(cand))
        tv = time.time()
        kept = []
        with ProcessPoolExecutor(max_workers=6) as ex:
            for i, r in enumerate(ex.map(verify_pair, cand, chunksize=2), 1):
                if r["fineCorr"] >= FINE_CORR:
                    kept.append(r)
                if i % 25 == 0:
                    print("  ... %d/%d (%.0fs)" % (i, len(cand), time.time() - tv))
        rows_all = kept
        print("复核后保留：%d（%.0fs）" % (len(rows_all), time.time() - tv))

    show = [r for r in rows_all if r["corr"] >= COARSE_CORR]
    for r in sorted(show, key=lambda r: -r.get("fineCorr", r["corr"])):
        print("  corr=%s   %-44s  %s <- %s  f=%s" % (
            r.get("fineCorr", r["corr"]), r["id"][:44],
            r["a"].split("/")[-1], r["b"].split("/")[-1],
            r.get("fineScale", r["scale"])))

    with open("tools/_crop-dup-report.json", "w", encoding="utf-8") as fh:
        json.dump(rows_all, fh, ensure_ascii=False, indent=1)
    print("\n明细：tools/_crop-dup-report.json")
