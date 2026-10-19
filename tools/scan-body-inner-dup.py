#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
删「同一篇文章正文里出现多次的同一张图」。

只针对 md5 完全相同的（不是相似，是同一份文件被引用了多次）。

⚠ 小图不动：二维码、头像、装饰图标常被有意放在文首和文末各一次，
   删掉反而破坏排版。所以只有「较大边 >= MIN_SIDE（默认 300px）」的内容图才去重。

用法：
  python tools/scan-body-inner-dup.py            # 只报告
  python tools/scan-body-inner-dup.py --fix      # 备份后修复（每组保留首次出现）
"""
import os
import re
import sys
import shutil
import hashlib
import datetime
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

MIN_SIDE = 300
STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP = os.path.join(ROOT, "..", "_innerdup-backup-" + STAMP, "drafts")
TRASH = os.path.join(ROOT, "..", "_innerdup-removed-" + STAMP)

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 16), b""):
            h.update(c)
    return h.hexdigest()


def find_groups():
    out = []
    for fn in sorted(os.listdir("drafts")):
        if not fn.endswith(".md") or fn.startswith("_"):
            continue
        path = os.path.join("drafts", fn)
        t = open(path, encoding="utf-8").read()
        m = FM_RE.match(t)
        if not m:
            continue
        refs = [r for r in IMG_RE.findall(t[m.end():])
                if r.startswith("images/") and os.path.exists(r)]
        seen = {}
        for r in refs:
            seen.setdefault(md5(r), []).append(r)
        for h, paths in seen.items():
            uniq = sorted(set(paths))
            if len(uniq) < 2:
                continue
            w, hh = Image.open(uniq[0]).size
            side = max(w, hh)
            if side < MIN_SIDE:
                continue          # 二维码/图标，可能是有意重复
            out.append({"id": fn[:-3], "file": path, "keep": uniq[0],
                        "drop": uniq[1:], "size": [w, hh]})
    return out


def main():
    groups = find_groups()
    print("正文内部重复（同文件、较大边>=%dpx）：%d 组" % (MIN_SIDE, len(groups)))
    for g in groups:
        print("  %-50s %-9s 保留 %s，删 %s" % (
            g["id"][:50], "%dx%d" % tuple(g["size"]),
            g["keep"].split("/")[-1], [p.split("/")[-1] for p in g["drop"]]))

    if "--fix" not in sys.argv:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --fix ——")
        return

    os.makedirs(BACKUP, exist_ok=True)
    changed = moved = 0
    for g in groups:
        src = g["file"]
        shutil.copy2(src, os.path.join(BACKUP, os.path.basename(src)))
        text = open(src, encoding="utf-8").read()
        for rel in g["drop"]:
            esc = re.escape(rel)
            new, n = re.subn(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?",
                             "", text, flags=re.M)
            if not n:
                new, n = re.subn(r"!\[[^\]]*\]\(" + esc + r"\)", "", text)
            if n:
                text = re.sub(r"\n{3,}", "\n\n", new)
                changed += 1
                if os.path.exists(rel):
                    dst = os.path.join(TRASH, rel)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(rel, dst)
                    moved += 1
        open(src, "w", encoding="utf-8", newline="\n").write(text)
    print("\n✓ 删除正文重复引用 %d 处，移出图片 %d 个" % (changed, moved))
    print("  备份 → %s" % os.path.relpath(BACKUP, ROOT))


if __name__ == "__main__":
    main()
