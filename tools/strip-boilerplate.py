#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
删掉公众号导入带进来的导语垃圾「…只有不到 0.00001% 的人」。

它同时污染两处：
  1) 正文第一段（单独成行）
  2) front-matter 的 excerpt:（导致列表页摘要也是这句废话）

做法：
  · 正文里整行只有这句 → 删整行（连同多余空行）
  · excerpt 的值就是这句 → 删掉 excerpt 字段，让导入脚本自动取正文开头

用法：
  python tools/strip-boilerplate.py            # 试算
  python tools/strip-boilerplate.py --apply    # 备份后执行
"""
import os
import re
import sys
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP = os.path.join(ROOT, "..", "_strip-backup-" + STAMP, "drafts")

# 判定：同时含 0.00001 且以「的人」结尾，且很短（避免误伤正文里真提到该数字的句子）
def is_spam(s):
    t = s.strip()
    return "0.00001" in t and t.rstrip("。！!").endswith("的人") and len(t) <= 40


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
        changed = False

        # 1) front-matter 里的 excerpt
        new_fm_lines, hit_fm = [], False
        for line in fm.splitlines():
            if line.lstrip().startswith("excerpt:"):
                val = line.split(":", 1)[1].strip()
                if is_spam(val):
                    hit_fm = True
                    changed = True
                    continue
            new_fm_lines.append(line)

        # 2) 正文里整行只有这句
        lines = body.split("\n")
        kept, hit_body = [], 0
        for line in lines:
            if is_spam(line):
                hit_body += 1
                changed = True
                continue
            kept.append(line)
        new_body = "\n".join(kept)
        # 清掉开头多余的空行
        new_body = re.sub(r"^\n{2,}", "", new_body)

        if changed:
            plan.append((fn, path, "---\n" + "\n".join(new_fm_lines) +
                         "\n---\n" + new_body, hit_fm, hit_body))

    print("命中 %d 篇" % len(plan))
    for fn, _, _, hf, hb in plan[:40]:
        print("  %-56s %s" % (fn[:56],
              ("删 excerpt " if hf else "") + ("删正文 %d 行" % hb if hb else "")))
    if len(plan) > 40:
        print("  …… 其余 %d 篇" % (len(plan) - 40))

    if not apply_:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --apply ——")
        return

    os.makedirs(BACKUP, exist_ok=True)
    for fn, path, new_text, _, _ in plan:
        shutil.copy2(path, os.path.join(BACKUP, fn))
        open(path, "w", encoding="utf-8", newline="\n").write(new_text)
    print("\n✓ 已修改 %d 篇，备份 → %s" % (len(plan), os.path.relpath(BACKUP, ROOT)))
    print("下一步：node tools/import-posts.js --replace && node tools/verify.js")


if __name__ == "__main__":
    main()
