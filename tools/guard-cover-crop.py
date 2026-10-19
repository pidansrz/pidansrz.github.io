#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
tools/guard-cover-crop.py — 发布前把关：禁止「头图是正文某图的裁切版」。

## 问题来源
公众号导入(tools/import-wechat.js)时，微信导出的 cover.jpg 往往是从正文第一张图
里裁出来的一块（宽高都被裁、还被压缩）。落库后就成了「头图是正文图的裁切版」——
详情页大图与列表缩略图用的是残缺版，正文里却还有完整版，既重复又别扭。本博客是
纯静态零依赖站点，这种「裁切封面」只能靠流程把关来杜绝。

## 本脚本做什么
在「把草稿导入 data.js 之后、正式发布之前」跑一遍，自动发现并（可选）修复：
  - 检查：对每篇文章，用归一化相关系数(NCC)比对 头图 vs 每张正文图；
    若头图是某张正文图的裁切（corr >= 阈值 且 方向为 头图∈正文图），即报警。
  - 修复(--fix)：把更完整的正文图提升为头图——
      · 若 JPEG 直接字节复制成 cover.jpg（不重编码，画质无损）；
      · 否则把 front-matter 的 cover 指向它；
    同时删掉正文里对它的重复引用，旧封面移出站点（可恢复）。

## 用法
  python tools/guard-cover-crop.py                 # 仅检查；发现裁切重复则退出码 1（可作发布闸门）
  python tools/guard-cover-crop.py --fix           # 自动修复后退出码 0
  python tools/guard-cover-crop.py --fix --apply   # 同 --fix（apply 为兼容别名）

零依赖（仅 PIL）。不修改任何文件，除非带 --fix / --apply。
"""
import os
import re
import sys
import shutil
import datetime
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

DRAFTS = "drafts"

# ---- 检测参数（与 find-crop-dups.py 一致，已在全站验证）----
W = 20                  # 粗筛空间里模板的宽度
STEP = 2                # 粗筛搜索步长
SCALES = [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 1.0]
MIN_STD = 10.0          # 模板/窗口标准差下限，太小说明是纯色块，不可比
THRESH = 0.92           # 报警阈值：>=0.92 且方向为「头图∈正文图」视为裁切重复

CACHE = {}


# ----------------------------------------------------------------------------
# 核心算法（多尺度 + 二维平移 的归一化相关系数）
# ----------------------------------------------------------------------------
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
    varx = n * sx2 - sx * sx
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
    """返回全方向/尺度/位置下的最大相关系数。dir='a-in-b' 表示 a 是 b 的裁切。"""
    best = {"corr": -2.0, "dir": None, "scale": None, "pos": None}
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
                best = {"corr": c, "dir": tag, "scale": f, "pos": pos}
    return best


def score_template(tpl_path, big_path, width=W, scales=SCALES, step=STEP):
    """单向：tpl 是否是 big 的一块裁切。返回 (corr, scale, pos)。"""
    tpl = load_gray(tpl_path, width)
    if tpl is None:
        return -2.0, None, None
    tstats = stats(tpl)
    best = (-2.0, None, None)
    for f in scales:
        bw = int(round(width / f))
        if bw < width:
            continue
        big = load_gray(big_path, bw)
        if big is None:
            continue
        c, pos = best_corr(tpl, tstats, big, step)
        if c is not None and c > best[0]:
            best = (c, f, pos)
    return best


def dim(path):
    try:
        im = Image.open(path)
        return im.size
    except Exception:
        return (None, None)


def scan_article(art):
    """单篇文章扫描（worker 用）；返回命中的清单"""
    cover = next((v for k, v in art["imgs"] if k == "cover"), None)
    if not cover or not os.path.exists(cover):
        return []
    cw, ch = dim(cover)
    if cw is None:
        return []
    bodies = [v for k, v in art["imgs"] if k != "cover" and os.path.exists(v)]
    hits = []
    for bv in bodies:
        if bv == cover:
            continue   # 正文直接引用了 cover 本身（同文件），不是裁切，交给去重处理
        bw, bh = dim(bv)
        if bw is None:
            continue
        c, f, _ = score_template(cover, bv)   # cover 是否 body 的裁切
        if c < THRESH:
            continue
        # 判据是「封面只覆盖了正文图的一部分」，而不是像素尺寸谁大谁小。
        # 裁切后若被放大，封面像素反而可能和源图同宽（甚至更大），
        # 用「必须严格更小」会漏掉这类（2026-08-11 就栽在这）。
        # f 是封面在正文图宽度上的占比：≈1 说明整幅画面都在，属于同图缩放，不是裁切。
        if f >= 0.98:
            continue
        hits.append({"id": art["id"], "file": art["file"],
                     "cover": cover, "keep": bv,
                     "corr": round(c, 4), "scale": f})
        break   # 一篇文章只需对第一张匹配的正文图修复
    return hits


def find_crop_covers(arts):
    """并行扫描所有文章，返回命中清单"""
    if not arts:
        return []
    hits = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for r in ex.map(scan_article, arts, chunksize=4):
            hits.extend(r)
    return hits


# ----------------------------------------------------------------------------
# 修复逻辑（提升完整图为正文头图，移出裁切封面）—— 复用自 fix-crop-dups.py
# ----------------------------------------------------------------------------
def move_away(src, dst_root):
    if not os.path.exists(src):
        return None
    dst = os.path.join(dst_root, src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    i = 1
    base, ext = os.path.splitext(dst)
    while os.path.exists(dst):
        dst = "%s.%d%s" % (base, i, ext)
        i += 1
    shutil.move(src, dst)
    return dst


def del_image_ref(text, rel):
    esc = re.escape(rel)
    whole = re.compile(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?", re.M)
    new, n = whole.subn("", text)
    if n:
        new = re.sub(r"\n{3,}", "\n\n", new)
        return new, n
    inline = re.compile(r"!\[[^\]]*\]\(" + esc + r"\)")
    return inline.subn("", text)


def set_cover(text, newcover):
    return re.sub(r"^cover:.*$", "cover: " + newcover, text, count=1, flags=re.M)


def is_jpeg(p):
    return p.lower().endswith((".jpg", ".jpeg"))


def apply_fix(hits):
    stamp = datetime.date.today().strftime("%Y%m%d")
    backup = os.path.join(ROOT, "..", "_cropguard-backup-" + stamp, "drafts")
    trash = os.path.join(ROOT, "..", "_cropguard-removed-" + stamp)
    os.makedirs(backup, exist_ok=True)
    os.makedirs(trash, exist_ok=True)

    drafts = {}
    for f in os.listdir(DRAFTS):
        if f.endswith(".md"):
            drafts[f] = open(os.path.join(DRAFTS, f), encoding="utf-8").read()

    changed = moved = 0
    for h in hits:
        fname, cover, keep = h["file"], h["cover"], h["keep"]
        if fname not in drafts:
            print("  ✗ 草稿不存在：%s" % fname)
            continue
        if not os.path.exists(keep):
            print("  ! 跳过（完整图已不在原地）：%s %s" % (h["id"][:40], keep.split("/")[-1]))
            continue
        text = drafts[fname]
        # 备份草稿（不覆盖）
        bdst = os.path.join(backup, fname)
        if not os.path.exists(bdst):
            shutil.copy2(os.path.join(DRAFTS, fname), bdst)
        # 正文里对 keep 的引用一并去掉，否则同图出现两次
        text, n = del_image_ref(text, keep)
        if is_jpeg(keep):
            tmp = os.path.join(ROOT, "..", "_cropguard-tmp-cover.jpg")
            if os.path.exists(cover):
                _t = os.path.join(trash, cover)
                os.makedirs(os.path.dirname(_t), exist_ok=True)
                shutil.copy2(cover, _t)                 # 先备份旧封面
            shutil.copy2(keep, tmp)
            shutil.move(tmp, cover)                      # 字节覆盖 cover，不重编码
            move_away(keep, trash)
            moved += 1
            print("   ✓ %s：cover.jpg ← %s（corr=%.3f，原封面已备份）" % (
                h["id"][:40], keep.split("/")[-1], h["corr"]))
        else:
            text = set_cover(text, keep)
            move_away(cover, trash)
            moved += 1
            print("   ✓ %s：cover 指向 %s（corr=%.3f）" % (h["id"][:40], keep, h["corr"]))
        open(os.path.join(DRAFTS, fname), "w", encoding="utf-8", newline="\n").write(text)
        changed += 1

    print("\n✓ 已修改草稿 %d 篇，移出图片 %d 个" % (changed, moved))
    print("   草稿备份：%s" % os.path.relpath(backup, ROOT))
    print("   图片移出：%s" % os.path.relpath(trash, ROOT))
    return changed


def main():
    do_fix = "--fix" in sys.argv or "--apply" in sys.argv
    arts = load_inventory()
    hits = find_crop_covers(arts)

    print("扫描文章 %d 篇" % len(arts))
    if not hits:
        print("✓ 未发现「头图是正文图裁切版」的情况，可以放心发布。")
        sys.exit(0)

    print("\n⚠ 发现 %d 篇存在头图裁切重复（头图是某张正文图的裁切）：" % len(hits))
    for h in hits:
        print("   %-46s  cover=%s  ←正文 %s  (corr=%.3f)" % (
            h["id"][:46], h["cover"].split("/")[-1],
            h["keep"].split("/")[-1], h["corr"]))

    if not do_fix:
        print("\n—— 未修改任何文件。要自动修复请加 --fix ——")
        print("   python tools/guard-cover-crop.py --fix")
        sys.exit(1)

    print("\n开始自动修复（把完整正文图提升为头图，移出裁切封面）...")
    apply_fix(hits)
    print("\n下一步：")
    print("  node tools/import-posts.js --replace")
    print("  python tools/add-image-sizes.py --apply")
    print("  node tools/mark-reposts.js --apply")
    print("  node tools/verify.js")
    sys.exit(0)


if __name__ == "__main__":
    main()
