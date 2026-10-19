#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
扫出「头图与正文某张图是同一个画面」的文章（尺寸不同也算）。

md5 完全相同只能抓到字节一致的；同一张图被压缩成不同尺寸后字节就变了，
这里用归一化相关系数（NCC）比对画面，尺寸不同也能认出来。

只保留头图，删掉正文里重复的那条引用。
用法：
  python tools/scan-cover-neardup.py            # 只报告
  python tools/scan-cover-neardup.py --fix      # 备份后修复
"""
import os
import re
import sys
import json
import shutil
import datetime
import importlib.util
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# guard-cover-crop.py 名字带连字符，不能直接 import
_spec = importlib.util.spec_from_file_location(
    "guard", os.path.join(ROOT, "tools", "guard-cover-crop.py"))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

THRESH = 0.92
STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP_DRAFTS = os.path.join(ROOT, "..", "_neardup-backup-" + STAMP, "drafts")
TRASH_IMAGES = os.path.join(ROOT, "..", "_neardup-removed-" + STAMP)
REPORT = "tools/_cover-neardup.json"

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)\)")


def parse(path):
    text = open(path, encoding="utf-8").read()
    m = FM_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, text[m.end():]


def task(fn):
    """正文图是否就是头图本身（可能是缩小/裁切过的同一画面）"""
    meta, body = parse(os.path.join("drafts", fn))
    cover = meta.get("cover", "").strip()
    if not cover or not os.path.exists(cover):
        return []
    from PIL import Image
    cw, ch = Image.open(cover).size
    out = []
    for rel in IMG_RE.findall(body):
        if not rel.startswith("images/") or rel == cover or not os.path.exists(rel):
            continue
        bw, bh = Image.open(rel).size
        # 正文图必须比头图小（或一样大）才可能是头图的缩小版
        if bw > cw or bh > ch:
            continue
        corr, f, _ = guard.score_template(rel, cover)   # 正文图 ⊂ 头图？
        if corr >= THRESH:
            out.append({"id": fn[:-3], "file": "drafts/" + fn,
                        "cover": cover, "dup": rel,
                        "corr": round(corr, 4), "scale": f,
                        "csize": [cw, ch], "bsize": [bw, bh]})
    return out


def main():
    files = sorted(f for f in os.listdir("drafts")
                   if f.endswith(".md") and not f.startswith("_"))
    hits = []
    with ProcessPoolExecutor(max_workers=6) as ex:
        for r in ex.map(task, files, chunksize=8):
            hits.extend(r)
    hits.sort(key=lambda x: -x["corr"])
    json.dump(hits, open(REPORT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("扫描 %d 篇，命中 %d 处 → %s" % (len(files), len(hits), REPORT))
    for h in hits[:30]:
        print("  %-50s corr=%.3f  头图%s  正文%s" % (
            h["id"][:50], h["corr"], h["csize"], h["bsize"]))

    if "--fix" not in sys.argv:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --fix ——")
        return

    os.makedirs(BACKUP_DRAFTS, exist_ok=True)
    changed = moved = 0
    for h in hits:
        src = h["file"]
        shutil.copy2(src, os.path.join(BACKUP_DRAFTS, os.path.basename(src)))
        text = open(src, encoding="utf-8").read()
        esc = re.escape(h["dup"])
        new, n = re.subn(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?",
                         "", text, flags=re.M)
        if not n:
            new, n = re.subn(r"!\[[^\]]*\]\(" + esc + r"\)", "", text)
        if not n:
            print("  ✗ %s 未匹配" % h["id"])
            continue
        open(src, "w", encoding="utf-8", newline="\n").write(
            re.sub(r"\n{3,}", "\n\n", new))
        changed += 1
        if os.path.exists(h["dup"]):
            dst = os.path.join(TRASH_IMAGES, h["dup"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(h["dup"], dst)
            moved += 1
    print("\n✓ 修改草稿 %d 处，移出重复图 %d 个" % (changed, moved))


if __name__ == "__main__":
    main()
