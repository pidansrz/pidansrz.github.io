# -*- coding: utf-8 -*-
"""
1) 将两篇指定文章（性高潮 / 为什么卖家希望你退货）的草稿移到备份目录（删除）。
2) 将剩余无正文文章的占位文案统一改为「（已404，无永久链接）」。
仅写这一个脚本，避免 shell 正则转义问题。
"""
import os, re, shutil

BLOG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(BLOG, "drafts")
BACKUP = os.path.join(BLOG, "..", "_delete-20261009")
os.makedirs(BACKUP, exist_ok=True)

DELETE = [
    "2026-09-05-xing-gao-chao-dao-di-shen-me-gan-jue-zhen-shi-ji-lu-duo-wei-nv-xing-de.md",
    "2026-09-09-wei-shen-me-mai-jia-xi-wang-ni-tui-huo.md",
]

PLACE_RE = re.compile(r"（疑似违规删除/已下线（[^）]*），无永久链接）")


def move_away(path):
    """冲突安全地把文件移出项目（沙箱禁止删除，move 目标已存在会退化成删除被拦）。"""
    rel = os.path.relpath(path, BLOG)
    dst = os.path.join(BACKUP, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    base, ext = os.path.splitext(dst)
    i = 1
    while os.path.exists(dst):
        dst = "%s_%d%s" % (base, i, ext)
        i += 1
    shutil.move(path, dst)
    return dst


# 1) 删除两篇
print("=== 删除目标文章 ===")
for f in DELETE:
    p = os.path.join(DRAFTS, f)
    if os.path.exists(p):
        dst = move_away(p)
        print("  已移出: %s -> %s" % (f, os.path.relpath(dst, BLOG)))
    else:
        print("  不存在(跳过): %s" % f)

# 2) 修改剩余草稿中的占位文案
print("\n=== 改写占位文案 ===")
changed = 0
for fn in sorted(os.listdir(DRAFTS)):
    if not fn.endswith(".md") or fn.startswith("_"):
        continue
    if fn in DELETE:
        continue
    p = os.path.join(DRAFTS, fn)
    t = open(p, encoding="utf-8").read()
    if "无永久链接" in t and PLACE_RE.search(t):
        new = PLACE_RE.sub("（已404，无永久链接）", t)
        open(p, "w", encoding="utf-8").write(new)
        changed += 1
        print("  %s" % fn)
print("改写完成：%d 篇" % changed)
