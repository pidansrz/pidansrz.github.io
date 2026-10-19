#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
扫「头图是正文图的横幅裁切」这类重复。

为什么需要单独一个脚本：
  微信导出时封面统一是 2.35:1 的横幅（900x382 / 641x273 / 1000x425 …），
  是直接从正文首图上下裁出来的一条。裁完还会被拉回原宽度，
  所以封面的像素宽和源图一样，"必须更小" 和 md5 都认不出来，
  归一化相关系数也只有 0.7~0.9（因为裁掉了大片上下内容）。

判定：
  1) 封面与正文图 **宽度相同**（同一导出的同一个文件被裁成两条）
  2) 把封面按原宽度贴到正文图上做上下滑动匹配，NCC >= --thresh（默认 0.70）
     —— f 固定为 1.0，只上下找位置，专门针对"横幅裁切"这个形态

处理原则与其它脚本一致：保留完整那张（正文图），删掉正文里那条重复引用。

用法：
  python tools/scan-cover-banner.py                 # 只报告
  python tools/scan-cover-banner.py --thresh 0.65   # 调阈值
  python tools/scan-cover-banner.py --fix           # 备份后修复
"""
import os
import re
import sys
import json
import shutil
import datetime
import importlib.util
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

_spec = importlib.util.spec_from_file_location(
    "guard", os.path.join(ROOT, "tools", "guard-cover-crop.py"))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

THRESH = 0.70
for a in sys.argv[1:]:
    if a.startswith("--thresh"):
        THRESH = float(a.split("=", 1)[1])

STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP = os.path.join(ROOT, "..", "_bannerdup-backup-" + STAMP, "drafts")
TRASH = os.path.join(ROOT, "..", "_bannerdup-removed-" + STAMP)
REPORT = "tools/_cover-banner.json"

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
    meta, body = parse(os.path.join("drafts", fn))
    cover = meta.get("cover", "").strip()
    if not cover or not os.path.exists(cover):
        return []
    try:
        cw, ch = Image.open(cover).size
    except Exception:
        return []
    out = []
    for rel in IMG_RE.findall(body):
        if not rel.startswith("images/") or rel == cover or not os.path.exists(rel):
            continue
        try:
            bw, bh = Image.open(rel).size
        except Exception:
            continue
        if abs(cw - bw) > 2:      # 必须同宽（同一导出）
            continue
        if ch >= bh:              # 封面必须更矮（是上下裁出来的一条）
            continue
        corr, f, pos = guard.score_template(cover, rel, scales=[1.0])
        if corr >= THRESH:
            out.append({"id": fn[:-3], "file": "drafts/" + fn,
                        "cover": cover, "dup": rel,
                        "corr": round(corr, 4), "pos": list(pos),
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
    print("扫描 %d 篇，阈值 %.2f，命中 %d 处 → %s" % (
        len(files), THRESH, len(hits), REPORT))
    for h in hits[:40]:
        print("  %-46s corr=%.3f 头图%s 正文%s" % (
            h["id"][:46], h["corr"], h["csize"], h["bsize"]))
    if len(hits) > 40:
        print("  …… 其余 %d 处见报告" % (len(hits) - 40))

    if "--fix" not in sys.argv:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --fix ——")
        return

    os.makedirs(BACKUP, exist_ok=True)
    changed = moved = 0
    for h in hits:
        src = h["file"]
        shutil.copy2(src, os.path.join(BACKUP, os.path.basename(src)))
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
            dst = os.path.join(TRASH, h["dup"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(h["dup"], dst)
            moved += 1
    print("\n✓ 修改草稿 %d 处，移出重复图 %d 个" % (changed, moved))


if __name__ == "__main__":
    main()
