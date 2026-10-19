#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
删掉文章里的署名行「文/船主」。

公众号导出的老文章常在正文开头或结尾单独留一行署名：
    文/船主
    文 / 船主
    文/船主综合于网络
搬到自己的博客上不需要再署名（作者就是站长本人），所以整行删掉。

注意：只删「整行就是署名」的行。正文里自称「船主」（如「船主觉得……」）
属于文章内容，一律不动。

用法：
  python tools/strip-byline.py            # 试算
  python tools/strip-byline.py --apply    # 备份后执行
"""
import os
import re
import sys
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP = os.path.join(ROOT, "..", "_byline-backup-" + STAMP, "drafts")

# 整行就是一个署名：「文 / 船主」「文/船主」「文/船主综合于网络」……
# 允许前后空白、斜杠两侧空格、后面跟少量补充说明。
BYLINE = re.compile(r"^\s*文\s*[／/]\s*船主\s*\S*\s*$")


def is_byline(line):
    return bool(BYLINE.match(line))


def main():
    apply_ = "--apply" in sys.argv
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

        lines = body.split("\n")
        kept, hit = [], 0
        for line in lines:
            if is_byline(line):
                hit += 1
                continue
            kept.append(line)
        if not hit:
            continue

        new_body = "\n".join(kept)
        # 署名在正文开头时，删掉后开头会空一行；在结尾时结尾会空几行。都收一下。
        new_body = re.sub(r"^\n{2,}", "", new_body)
        new_body = new_body.rstrip() + "\n"
        plan.append((fn, path, "---\n" + fm + "\n---\n" + new_body, hit))

    total = sum(p[3] for p in plan)
    print("命中 %d 篇 / %d 行" % (len(plan), total))
    for fn, _, _, hit in plan:
        print("  %-58s 删 %d 行" % (fn[:58], hit))

    if not apply_:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --apply ——")
        return

    os.makedirs(BACKUP, exist_ok=True)
    for fn, path, new_text, _ in plan:
        shutil.copy2(path, os.path.join(BACKUP, fn))
        open(path, "w", encoding="utf-8", newline="\n").write(new_text)
    print("\n✓ 已修改 %d 篇（共删 %d 行），备份 → %s"
          % (len(plan), total, os.path.relpath(BACKUP, ROOT)))
    print("下一步：node tools/import-posts.js --replace && node tools/verify.js")


if __name__ == "__main__":
    main()
