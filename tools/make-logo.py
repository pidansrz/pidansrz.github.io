# -*- coding: utf-8 -*-
"""从设计稿生成博客 logo（透明背景 PNG，深浅两版）。

用法：
    python tools/make-logo.py <输入图> [--pad 24] [--apply]

输入：白/米白底设计稿（logo 居中，四周留白）。
输出：
    images/logo-pidan.png        深色字版（浅色主题用）
    images/logo-pidan-light.png  浅色字版（深色主题用，橙点保留原色）

背景判定：取四角均值作为背景色，按颜色距离算连续 alpha（平滑抗锯齿），
再用 3x3 中值滤掉 JPG 噪点造成的孤立杂点。浅色版把深灰文字替换为暖灰，
橙色点（i 上的圆点）检测保留，避免 invert 把橙色变蓝。
"""
import sys
from PIL import Image, ImageFilter

OUT_DARK = "images/logo-pidan.png"
OUT_LIGHT = "images/logo-pidan-light.png"
BG_TOL_LO = 12   # 距离小于此值 → 全透明
BG_TOL_HI = 42   # 距离大于此值 → 全不透明（之间线性过渡）
LIGHT_INK = (217, 215, 209)  # 深色主题下的文字色（暖灰）


def estimate_bg(im):
    w, h = im.size
    pts = [(6, 6), (w - 7, 6), (6, h - 7), (w - 7, h - 7)]
    px = im.load()
    rs = sum(px[x, y][0] for x, y in pts) // 4
    gs = sum(px[x, y][1] for x, y in pts) // 4
    bs = sum(px[x, y][2] for x, y in pts) // 4
    return (rs, gs, bs)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply_flag = "--apply" in sys.argv
    pad = 24
    if "--pad" in sys.argv:
        pad = int(sys.argv[sys.argv.index("--pad") + 1])
    if not args:
        print("用法: python tools/make-logo.py <输入图> [--pad 24] [--apply]")
        sys.exit(1)

    im = Image.open(args[0]).convert("RGB")
    w, h = im.size
    bg = estimate_bg(im)
    print("原图 %dx%d，估计背景色 %s" % (w, h, bg))

    # —— 连续 alpha 抠图（Chebyshev 距离）——
    src = im.load()
    alpha = Image.new("L", (w, h), 0)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
            if d <= BG_TOL_LO:
                ap[x, y] = 0
            elif d >= BG_TOL_HI:
                ap[x, y] = 255
            else:
                ap[x, y] = int(round((d - BG_TOL_LO) * 255.0 / (BG_TOL_HI - BG_TOL_LO)))

    # —— 去噪：3x3 中值，清掉 JPG 在背景里的孤立杂点 ——
    alpha = alpha.filter(ImageFilter.MedianFilter(3))

    # —— 裁到内容边界 + padding ——
    bbox = alpha.point(lambda p: 255 if p > 40 else 0).getbbox()
    if not bbox:
        print("未找到内容（整幅都被判成背景）")
        sys.exit(1)
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(w, r + pad); b = min(h, b + pad)
    im = im.crop((l, t, r, b))
    alpha = alpha.crop((l, t, r, b))
    print("裁切后 %dx%d（内容 %dx%d + 四边 padding %d）" % (im.size[0], im.size[1], r - l - 2 * pad, b - t - 2 * pad, pad))

    # —— 深色版：文字保留原色 ——
    dark = im.convert("RGBA")
    dark.putalpha(alpha)

    # —— 浅色版：深灰文字 → 暖灰，橙色点保留 ——
    sp = im.load()
    ap2 = alpha.load()
    light = Image.new("RGBA", im.size)
    lp = light.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b = sp[x, y][:3]
            a = ap2[x, y]
            if a == 0:
                lp[x, y] = (0, 0, 0, 0)
            elif r > 150 and (r - b) > 60:      # 橙点（i 上的圆点）
                lp[x, y] = (r, g, b, a)
            else:
                lp[x, y] = LIGHT_INK + (a,)

    if not apply_flag:
        print("dry-run：加 --apply 写出")
        print("  %s (%dx%d)" % (OUT_DARK, dark.size[0], dark.size[1]))
        print("  %s (%dx%d)" % (OUT_LIGHT, light.size[0], light.size[1]))
        return

    dark.save(OUT_DARK)
    light.save(OUT_LIGHT)
    print("✓ 已写出 %s (%d bytes)" % (OUT_DARK, len(open(OUT_DARK, "rb").read())))
    print("✓ 已写出 %s (%d bytes)" % (OUT_LIGHT, len(open(OUT_LIGHT, "rb").read())))


if __name__ == "__main__":
    main()
