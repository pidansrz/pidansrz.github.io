#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
按清单删掉某张配图：同时清掉文章里的引用，避免留下破图。

清单由 tools/scan-promo-card.py 产出（每项含 path）。

做三件事：
  1) 从 drafts/*.md 正文里删掉指向这些图的 Markdown 图片（整行删，行里还有别的内容就只摘掉图片）
  2) 图片文件移出站点 → ../_promocard-removed-<日期>/（保留目录结构，可恢复，不硬删）
  3) 草稿改动前先备份 → ../_promocard-backup-<日期>/drafts/

用法：
  python tools/remove-promo-card.py tools/_promo-hits.json            # 试算
  python tools/remove-promo-card.py tools/_promo-hits.json --apply    # 执行
"""
import os
import re
import sys
import json
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = datetime.date.today().strftime("%Y%m%d")
BAK_DRAFTS = os.path.join(ROOT, "..", "_promocard-backup-" + STAMP, "drafts")
GONE = os.path.join(ROOT, "..", "_promocard-removed-" + STAMP)


def norm(p):
    return p.replace("\\", "/").lstrip("./")


def move_away(src, dst):
    """移动文件，目标同名已存在时加序号，绝不覆盖。"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    base, ext = os.path.splitext(dst)
    i = 1
    while os.path.exists(dst):
        dst = "%s-%d%s" % (base, i, ext)
        i += 1
    shutil.move(src, dst)
    return dst


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    apply_ = "--apply" in sys.argv
    lst = json.load(open(sys.argv[1], encoding="utf-8"))
    targets = {norm(x["path"]) for x in lst}
    print("清单：%d 张图" % len(targets))
    for t in sorted(targets):
        print("  " + t)

    # 1) 草稿
    plan = []
    for fn in sorted(os.listdir("drafts")):
        if not fn.endswith(".md") or fn.startswith("_"):
            continue
        path = os.path.join("drafts", fn)
        text = open(path, encoding="utf-8").read()
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        if not m:
            continue
        fm, body = m.group(1), text[m.end():]

        kept, killed, hit_lines = [], 0, []
        for line in body.split("\n"):
            hit = False
            for t in targets:
                pat = re.compile(r"!\[[^\]]*\]\(\s*" + re.escape(t) + r"(\s+\"[^\"]*\")?\s*\)")
                if pat.search(line):
                    line = pat.sub("", line)
                    hit = True
            if hit:
                killed += 1
                if not line.strip():
                    continue          # 整行只剩图片 → 删整行
                line = line.strip()   # 行里还有正文 → 只摘掉图片
            kept.append(line)
        if not killed:
            continue
        new_body = "\n".join(kept)
        new_body = re.sub(r"\n{3,}", "\n\n", new_body).strip("\n") + "\n"
        plan.append((fn, path, "---\n" + fm + "\n---\n" + new_body, killed))

    print("\n草稿命中 %d 篇 / %d 处引用" % (len(plan), sum(p[3] for p in plan)))
    for fn, _, _, k in plan:
        print("  %-62s 删 %d 处" % (fn[:62], k))

    # 2) 复核：改完之后草稿里是否还残留对这些图的引用
    after = {}
    planned = {p[1]: p[2] for p in plan}
    for fn in os.listdir("drafts"):
        if not fn.endswith(".md"):
            continue
        p = os.path.join("drafts", fn)
        after[p] = planned.get(p) or open(p, encoding="utf-8").read()
    residue = [(p, t) for p, txt in after.items() for t in targets if t in txt]
    if residue:
        print("\n⚠ 这些引用没被清掉（出现在正文以外的位置，需人工看一眼）：")
        for p, t in residue:
            print("  %-50s %s" % (p[:50], t))

    if not apply_:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --apply ——")
        return

    os.makedirs(BAK_DRAFTS, exist_ok=True)
    for fn, path, new_text, _ in plan:
        shutil.copy2(path, os.path.join(BAK_DRAFTS, fn))
        open(path, "w", encoding="utf-8", newline="\n").write(new_text)

    moved = 0
    for t in sorted(targets):
        if os.path.exists(t):
            move_away(t, os.path.join(GONE, t))
            moved += 1
    print("\n✓ 草稿改 %d 篇；图片移出 %d 张 → %s"
          % (len(plan), moved, os.path.relpath(GONE, ROOT)))
    print("  草稿备份 → %s" % os.path.relpath(BAK_DRAFTS, ROOT))
    print("下一步：node tools/import-posts.js --replace && node tools/verify.js")


if __name__ == "__main__":
    main()
