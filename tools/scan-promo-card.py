#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
找出全站配图里与「某张样图」相同的图片（用于批量清理公众号尾巴卡片这类重复噪音）。

原理：把样图和候选图都缩放到同一尺寸后算归一化相关系数（NCC）。
公众号导出的固定卡片（如「分享给小伙伴 / 关注我 / 错过精彩」那张）在不同文章里
可能被重新压缩、尺寸略有差异，但画面完全一致，NCC 通常在 0.95 以上；
无关图片一般在 0.6 以下，区分度很好。

为兼容「卡片被塞进一张更大截图里」的情况，候选图会试两种归一化：
  1) 直接拉伸到样图尺寸
  2) 按比例缩放后中心裁切（保留画面中部）
取两者最大值。

用法：
  python tools/scan-promo-card.py <样图路径> [--threshold 0.9] [--json out.json]
"""
import os
import sys
import json
import argparse
from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

W, H = 200, 107          # 样图 500x268 等比缩到 200 宽


def prep(path, stretch=True):
    im = Image.open(path)
    if getattr(im, "is_animated", False):
        im.seek(0)
    im = im.convert("L")
    if stretch:
        im = im.resize((W, H), Image.BILINEAR)
    else:
        w, h = im.size
        scale = W / float(w)
        im = im.resize((W, max(1, int(round(h * scale)))), Image.BILINEAR)
        if im.size[1] >= H:
            top = (im.size[1] - H) // 2
            im = im.crop((0, top, W, top + H))
        else:
            canvas = Image.new("L", (W, H), 255)
            canvas.paste(im, (0, (H - im.size[1]) // 2))
            im = canvas
    return im


def ncc(a, b):
    """归一化相关系数。只用 PIL 的基础统计量：
       Σxy = (Σx² + Σy² − Σ(x−y)²) / 2
    这样不需要 numpy，也不需要 PIL 不支持 F 模式的减法/乘法。"""
    sa, sa2, n = ImageStat.Stat(a).sum[0], ImageStat.Stat(a).sum2[0], a.width * a.height
    sb, sb2, m = ImageStat.Stat(b).sum[0], ImageStat.Stat(b).sum2[0], b.width * b.height
    var_a = n * sa2 - sa * sa
    var_b = m * sb2 - sb * sb
    if var_a <= 0 or var_b <= 0:
        return 0.0
    d2 = ImageStat.Stat(ImageChops.difference(a, b)).sum2[0]
    sxy = (sa2 + sb2 - d2) / 2.0
    num = n * sxy - sa * sb
    return num / (var_a * var_b) ** 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("template")
    ap.add_argument("--threshold", type=float, default=0.9)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    tpl_path = args.template
    tpl = prep(tpl_path, True)

    rows = []
    for dirpath, _, files in os.walk("images"):
        for fn in files:
            if not fn.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
                continue
            p = os.path.join(dirpath, fn)
            try:
                c1 = ncc(tpl, prep(p, True))
                c2 = ncc(tpl, prep(p, False))
            except Exception as e:
                print("  ! 跳过 %s (%s)" % (p, e))
                continue
            rows.append((max(c1, c2), p, Image.open(p).size))

    rows.sort(reverse=True)
    hits = [r for r in rows if r[0] >= args.threshold]
    print("扫描 %d 张图，NCC ≥ %.2f 的 %d 张：" % (len(rows), args.threshold, len(hits)))
    for corr, p, size in hits:
        print("  %.4f  %-72s %sx%s" % (corr, p, size[0], size[1]))
    print("\n—— 前 10 名（含未达阈值的，便于判断阈值是否合适）——")
    for corr, p, size in rows[:10]:
        print("  %.4f  %-72s %sx%s" % (corr, p, size[0], size[1]))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump([{"corr": round(c, 6), "path": p, "size": list(s)}
                       for c, p, s in hits], f, ensure_ascii=False, indent=2)
        print("\n清单已写入 %s" % args.json)


if __name__ == "__main__":
    main()
