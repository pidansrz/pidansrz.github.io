#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把正文里自称的「船主」改成「我」。

「船主」是站长的旧笔名（皮蛋瘦肉舟 → 舟 → 船主），公众号时代用来指代自己，
例如「船主觉得……」「船主认为……」「船主的同事……」。搬到自己的博客上，
读者并不知道「船主」是谁，统一改成「我」。

只改两处：
  1) 正文里的 船主 → 我
  2) front-matter 的 excerpt（它是正文开头的拷贝，需要同步，否则摘要与正文不一致）

不碰：
  · title / coverAlt 等其它字段（里面本来也没有）
  · 【船主按】这类固定栏目名 —— 改成「我按」不成话，脚本会单独列出来让人决定

用法：
  python tools/replace-penname.py            # 试算（列出每处改动的上下文）
  python tools/replace-penname.py --apply    # 备份后执行
"""
import os
import re
import sys
import shutil
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP = os.path.join(ROOT, "..", "_penname-backup-" + STAMP, "drafts")

OLD, NEW = "船主", "我"
# 固定栏目名：单独报告，不自动改
FIXED = re.compile(r"【\s*船主\s*按\s*】")


def main():
    apply_ = "--apply" in sys.argv
    plan, fixed_hits = [], []

    for fn in sorted(os.listdir("drafts")):
        if not fn.endswith(".md") or fn.startswith("_"):
            continue
        path = os.path.join("drafts", fn)
        text = open(path, encoding="utf-8").read()
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        if not m:
            continue
        fm, body = m.group(1), text[m.end():]

        # 固定栏目名先记下来，再保护起来，避免被整体替换
        for fm_hit in FIXED.findall(body):
            fixed_hits.append((fn, fm_hit))

        # 先把固定栏目名里的「船主」藏起来（用占位符），替换完再放回去
        guard = lambda s: FIXED.sub(lambda mm: mm.group(0).replace(OLD, "\u0000"), s)
        guarded_body = guard(body)
        n_body = guarded_body.count(OLD)
        new_body = guarded_body.replace(OLD, NEW).replace("\u0000", OLD)

        # front-matter 里的 excerpt 同步改（同样要跳过固定栏目名）
        new_fm_lines, n_fm = [], 0
        for line in fm.splitlines():
            if line.lstrip().startswith("excerpt:") and OLD in line:
                guarded = guard(line)
                n_fm += guarded.count(OLD)
                line = guarded.replace(OLD, NEW).replace("\u0000", OLD)
            new_fm_lines.append(line)

        if not (n_body or n_fm):
            continue
        plan.append((fn, path, "---\n" + "\n".join(new_fm_lines) + "\n---\n"
                     + new_body, n_body, n_fm))

    total = sum(p[3] + p[4] for p in plan)
    print("命中 %d 篇 / %d 处（正文 %d，摘要 %d）"
          % (len(plan), total, sum(p[3] for p in plan), sum(p[4] for p in plan)))
    for fn, _, _, nb, nf in plan:
        print("  %-52s 正文 %d 处%s" % (fn[:52], nb, ("，摘要 %d 处" % nf) if nf else ""))

    if fixed_hits:
        print("\n⚠ 以下固定栏目名含「船主」，未自动改动（改成「我」不成话）：")
        for fn, s in fixed_hits:
            print("  %-52s %s" % (fn[:52], s))

    if not apply_:
        print("\n—— 试算结束（未改动任何文件）。确认后加 --apply ——")
        return

    os.makedirs(BACKUP, exist_ok=True)
    for fn, path, new_text, _, _ in plan:
        shutil.copy2(path, os.path.join(BACKUP, fn))
        open(path, "w", encoding="utf-8", newline="\n").write(new_text)
    print("\n✓ 已修改 %d 篇（共 %d 处），备份 → %s"
          % (len(plan), total, os.path.relpath(BACKUP, ROOT)))
    print("下一步：node tools/import-posts.js --replace && node tools/verify.js")


if __name__ == "__main__":
    main()
