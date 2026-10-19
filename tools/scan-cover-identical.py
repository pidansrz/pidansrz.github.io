#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
扫出「头图与正文配图完全相同」的文章。

与「裁切重复」是两类问题：
  - 裁切：头图是正文某图被裁掉一块的残缺版    → guard-cover-crop.py 管
  - 完全相同：同一张图既当头图、正文里又来一遍 → 本脚本管

判定：
  1) 正文里直接写了与 cover 相同的路径（如 ![](images/x/cover.jpg)）
  2) 正文引用的图文件与 cover 文件的 md5 完全相同（内容一致，只是文件名不同）

处理原则：保留头图，删掉正文里重复的那一条引用（图片文件只在没人引用时移出）。

用法：
  python tools/scan-cover-identical.py            # 只报告
  python tools/scan-cover-identical.py --fix      # 备份后修复
"""
import os
import re
import sys
import json
import shutil
import hashlib
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP_DRAFTS = os.path.join(ROOT, "..", "_coverdup-backup-" + STAMP, "drafts")
TRASH_IMAGES = os.path.join(ROOT, "..", "_coverdup-removed-" + STAMP)
REPORT = "tools/_cover-identical.json"

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def parse(path):
    text = open(path, encoding="utf-8").read()
    m = FM_RE.match(text)
    if not m:
        return None, text
    meta, body = {}, text[m.end():]
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body


def del_image(text, rel):
    """删掉引用 rel 的那张图；返回 (新文本, 删除次数)"""
    esc = re.escape(rel)
    whole = re.compile(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?", re.M)
    new, n = whole.subn("", text)
    if n:
        return re.sub(r"\n{3,}", "\n\n", new), n
    inline = re.compile(r"!\[[^\]]*\]\(" + esc + r"\)")
    return inline.subn("", text)


def scan():
    hits = []
    for fn in sorted(os.listdir("drafts")):
        if not fn.endswith(".md") or fn.startswith("_"):
            continue
        meta, body = parse(os.path.join("drafts", fn))
        if not meta:
            continue
        cover = meta.get("cover", "").strip()
        if not cover or not os.path.exists(cover):
            continue
        cover_md5 = md5(cover)
        for rel in IMG_RE.findall(body):
            if not rel.startswith("images/"):
                continue
            if rel == cover:
                hits.append({"id": fn[:-3], "file": "drafts/" + fn,
                             "cover": cover, "dup": rel, "reason": "正文直接引用了头图"})
                continue
            if os.path.exists(rel) and md5(rel) == cover_md5:
                hits.append({"id": fn[:-3], "file": "drafts/" + fn,
                             "cover": cover, "dup": rel, "reason": "与头图内容完全相同"})
    return hits


def main():
    hits = scan()
    json.dump(hits, open(REPORT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("扫描完成，命中 %d 处：%s" % (len(hits), REPORT))
    for h in hits[:40]:
        print("  %-52s 删正文图 %-28s (%s)" % (
            h["id"][:52], h["dup"].split("/")[-1], h["reason"]))
    if len(hits) > 40:
        print("  …… 其余 %d 处见报告" % (len(hits) - 40))

    if "--fix" not in sys.argv:
        print("\n—— 试算结束（未改动任何文件）。确认无误后加 --fix ——")
        return

    os.makedirs(BACKUP_DRAFTS, exist_ok=True)
    changed = moved = 0
    for h in hits:
        src = h["file"]
        shutil.copy2(src, os.path.join(BACKUP_DRAFTS, os.path.basename(src)))
        text = open(src, encoding="utf-8").read()
        new, n = del_image(text, h["dup"])
        if not n:
            print("  ✗ %s 未匹配到图片行" % h["id"])
            continue
        open(src, "w", encoding="utf-8", newline="\n").write(new)
        changed += 1
        # 头图自己不能被移走；只移出「与头图不同文件」的那张重复图
        if h["dup"] != h["cover"] and os.path.exists(h["dup"]):
            dst = os.path.join(TRASH_IMAGES, h["dup"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(h["dup"], dst)
            moved += 1
    print("\n✓ 修改草稿 %d 处，移出重复图 %d 个" % (changed, moved))
    print("  备份：%s" % os.path.relpath(BACKUP_DRAFTS, ROOT))
    print("  移出：%s" % os.path.relpath(TRASH_IMAGES, ROOT))


if __name__ == "__main__":
    main()
