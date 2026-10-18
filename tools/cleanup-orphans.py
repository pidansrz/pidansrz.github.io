# -*- coding: utf-8 -*-
"""
收尾清理：
  1) 若有草稿仍指向「内容是 GIF 却叫 .jpg」的文件，改指到同名的 .gif
  2) 把确认无用的孤儿文件移出项目（沙箱禁止删除，只能移走）
"""
import os
import re
import shutil
from PIL import Image

BLOG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(BLOG, "drafts")
IMAGES = os.path.join(BLOG, "images")
TRASH = os.path.join(os.path.dirname(BLOG), "_giffix-removed-20261009")

RE_INLINE = re.compile(r"\]\((images/[^)\s\"]+)\)")
RE_COVER = re.compile(r"^cover:\s*(images/\S+)", re.M)

# --- 1. 找出所有「.jpg 名但内容是 GIF」的文件 ---
gish = []
for root, _, fs in os.walk(IMAGES):
    for f in fs:
        if not f.lower().endswith(".jpg"):
            continue
        p = os.path.join(root, f)
        try:
            if Image.open(p).format == "GIF":
                gish.append(os.path.relpath(p, BLOG).replace("\\", "/"))
        except Exception:
            pass

fixed = 0
for rel in gish:
    gif_rel = os.path.splitext(rel)[0] + ".gif"
    if not os.path.exists(os.path.join(BLOG, gif_rel)):
        continue
    for f in os.listdir(DRAFTS):
        if not f.endswith(".md") or f == "README.md" or f.startswith("_"):
            continue
        fp = os.path.join(DRAFTS, f)
        t = open(fp, encoding="utf-8").read()
        new = t.replace("](%s)" % rel, "](%s)" % gif_rel).replace(": %s\n" % rel, ": %s\n" % gif_rel)
        if new != t:
            open(fp, "w", encoding="utf-8").write(new)
            fixed += 1
print("把 %d 篇草稿的 GIF 引用改到正确的 .gif 文件（共检查 %d 个异常文件）" % (fixed, len(gish)))

# --- 2. 重新计算孤儿并移出 ---
refs = set()
for f in os.listdir(DRAFTS):
    if not f.endswith(".md") or f == "README.md" or f.startswith("_"):
        continue
    t = open(os.path.join(DRAFTS, f), encoding="utf-8").read()
    refs |= set(m.group(1) for m in RE_INLINE.finditer(t))
    refs |= set(m.group(1) for m in RE_COVER.finditer(t))

disk = []
for root, _, fs in os.walk(IMAGES):
    for x in fs:
        disk.append(os.path.relpath(os.path.join(root, x), BLOG).replace("\\", "/"))

orphan = [p for p in disk if p not in refs and p != "images/og-default.jpg"]
print("孤儿文件 %d 个，合计 %.1f MB" % (len(orphan), sum(os.path.getsize(os.path.join(BLOG, p)) for p in orphan) / 1048576))

moved = 0
failed = 0
for p in orphan:
    src = os.path.join(BLOG, p)
    dst = os.path.join(TRASH, p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n = 1
    while os.path.exists(dst):
        base, ext = os.path.splitext(dst)
        dst = "%s~%d%s" % (base, n, ext)
        n += 1
    try:
        shutil.move(src, dst)
        moved += 1
    except Exception:
        failed += 1
print("移出 %d 个，失败 %d 个" % (moved, failed))
