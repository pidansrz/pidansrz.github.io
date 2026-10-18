# -*- coding: utf-8 -*-
"""核对 drafts/ 的图片引用与 images/ 实际内容是否一一对应。"""
import os
import re
from PIL import Image

BLOG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(BLOG, "drafts")
IMAGES = os.path.join(BLOG, "images")

RE_INLINE = re.compile(r"\]\((images/[^)\s\"]+)\)")
RE_COVER = re.compile(r"^cover:\s*(images/\S+)", re.M)

refs = set()
per_file = {}
for f in sorted(os.listdir(DRAFTS)):
    if not f.endswith(".md") or f == "README.md" or f.startswith("_"):
        continue
    t = open(os.path.join(DRAFTS, f), encoding="utf-8").read()
    got = set(m.group(1) for m in RE_INLINE.finditer(t))
    got |= set(m.group(1) for m in RE_COVER.finditer(t))
    per_file[f] = got
    refs |= got

disk = set()
for root, _, fs in os.walk(IMAGES):
    for x in fs:
        disk.add(os.path.relpath(os.path.join(root, x), BLOG).replace("\\", "/"))

missing = sorted(r for r in refs if not os.path.exists(os.path.join(BLOG, r)))
# og-default 由 app.js 直接引用，不在草稿里
orphan = sorted(p for p in disk if p not in refs and p != "images/og-default.jpg")

print("草稿引用图片（去重）：%d" % len(refs))
print("磁盘图片：%d" % len(disk))
print("引用了但文件不存在：%d" % len(missing))
for m in missing[:8]:
    print("    " + m)
print("磁盘上有、但没人引用：%d" % len(orphan))
tot = sum(os.path.getsize(os.path.join(BLOG, p)) for p in orphan)
print("孤儿体积：%.1f MB" % (tot / 1048576))
for p in orphan[:10]:
    print("    " + p)

# 扩展名与真实格式是否一致
bad = []
for p in sorted(disk):
    try:
        fmt = Image.open(os.path.join(BLOG, p)).format
    except Exception:
        bad.append((p, "打不开"))
        continue
    ext = os.path.splitext(p)[1].lower().lstrip(".")
    if ext == "jpg":
        ext = "jpeg"
    if fmt and fmt.lower() != ext:
        bad.append((p, "%s≠%s" % (ext, fmt)))
print("扩展名与真实格式不符：%d" % len(bad))
for p, w in bad[:10]:
    print("    %-70s %s" % (p[:70], w))
