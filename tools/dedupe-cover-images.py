#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
去掉「文章头图 与 正文配图 重复」的那一张。

原理：
  公众号文章导入时，封面图被单独存成 cover.jpg，正文里的同一张图又被存成
  img_XX.jpg。作者若把正文首图设为封面，页面就会出现「顶部一张 + 正文一张」
  同一画面、尺寸不同的两张图。

做法（统一规则）：
  保留头图（它同时承担列表页缩略图与文章页顶部视觉锚点，且分辨率不低于正文
  那张），删掉正文里重复的那张引用；对应的图片文件移入备份目录，不留在站点里。

  确认清单来自 tools/_dup-confirmed.json（由 find-dup-images.py 扫描 + 人工
  放大目视逐对确认，已剔除"白底截图直方图相近"这类误判）。

用法：
  python tools/dedupe-cover-images.py               # 试算，不改任何文件
  python tools/dedupe-cover-images.py --apply       # 备份后真正执行
"""
import json
import os
import re
import shutil
import sys
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

CONFIRMED = "tools/_dup-confirmed.json"
STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP_DRAFTS = os.path.join(ROOT, "..", "_dedupe-backup-" + STAMP, "drafts")
TRASH_IMAGES = os.path.join(ROOT, "..", "_dedupe-removed-" + STAMP)


def load_confirmed():
    if not os.path.exists(CONFIRMED):
        sys.exit("缺少 %s（先跑 find-dup-images.py 并确认清单）" % CONFIRMED)
    return json.load(open(CONFIRMED, encoding="utf-8"))["items"]


def all_draft_texts():
    out = {}
    for f in os.listdir("drafts"):
        if f.endswith(".md"):
            out[f] = open(os.path.join("drafts", f), encoding="utf-8").read()
    return out


def del_image_line(text, rel):
    """删掉引用 rel 的那张图；返回 (新文本, 删除次数)

    草稿里图片有两种排版：
      a) 图片独立成行      → 整行删掉（连换行），避免留下空行；
      b) 图片紧接正文首段  → 只摘掉 ![](...) 标记，后面的正文一个字都不能动。
    """
    esc = re.escape(rel)
    # a) 整行只有一张图
    whole = re.compile(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?", re.M)
    new, n = whole.subn("", text)
    if n:
        new = re.sub(r"\n{3,}", "\n\n", new)
        return new, n
    # b) 图后紧跟文字：只删标记本身
    inline = re.compile(r"!\[[^\]]*\]\(" + esc + r"\)")
    new, n = inline.subn("", text)
    return new, n


def main():
    apply = "--apply" in sys.argv
    items = load_confirmed()
    drafts = all_draft_texts()

    plan, missing, dup_refs = [], [], []
    for it in items:
        pid, dup = it["id"], it["dup"]
        fname = pid + ".md"
        if fname not in drafts:
            missing.append((fname, "草稿不存在"))
            continue
        text = drafts[fname]
        if dup not in text:
            missing.append((fname, "草稿里没找到该图引用：" + dup))
            continue
        # 该图是否被别的草稿也引用（正常不会）
        others = [f for f, t in drafts.items() if f != fname and dup in t]
        if others:
            dup_refs.append((dup, others))
            continue
        plan.append((fname, pid, dup))

    print("确认清单：%d 对" % len(items))
    print("可处理：%d 篇；跳过：%d" % (len(plan), len(missing)))
    for f, why in missing:
        print("   - 跳过 %s  (%s)" % (f, why))
    if dup_refs:
        print("   注意：以下图被多篇草稿引用，已跳过：")
        for d, o in dup_refs:
            print("     %s -> %s" % (d, o))
    print()
    total_bytes = sum(os.path.getsize(p) for _, _, p in plan if os.path.exists(p))
    print("将删除正文图 %d 个，合计 %.1f KB" % (
        len(plan), total_bytes / 1024))

    if not apply:
        print()
        print("—— 试算结束（未改动任何文件）。确认无误后加 --apply ——")
        return

    # 备份草稿（已存在的不覆盖——保住最早那份「改动前」的原始快照）
    os.makedirs(BACKUP_DRAFTS, exist_ok=True)
    kept = 0
    for f, _, _ in plan:
        dst = os.path.join(BACKUP_DRAFTS, f)
        if not os.path.exists(dst):
            shutil.copy2(os.path.join("drafts", f), dst)
        else:
            kept += 1
    print("✓ 草稿已备份到 %s（已有 %d 份未覆盖）" % (
        os.path.relpath(BACKUP_DRAFTS, ROOT), kept))

    changed = 0
    moved = 0
    for fname, pid, dup in plan:
        path = os.path.join("drafts", fname)
        text = open(path, encoding="utf-8").read()
        new, n = del_image_line(text, dup)
        if not n:
            print("   ✗ %s：未匹配到图片行" % fname)
            continue
        open(path, "w", encoding="utf-8", newline="\n").write(new)
        changed += 1
        # 图片文件移入备份目录（保留原有目录层级）
        if os.path.exists(dup):
            dst = os.path.join(TRASH_IMAGES, dup)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(dup, dst)
            moved += 1
    print("✓ 已修改草稿 %d 篇，移出图片 %d 个 → %s" % (
        changed, moved, os.path.relpath(TRASH_IMAGES, ROOT)))
    print()
    print("下一步：")
    print("  node tools/import-posts.js          # 重新导入（会自动重建派生文件）")
    print("  python tools/add-image-sizes.py --apply")
    print("  node tools/mark-reposts.js --apply")
    print("  node tools/verify.js")


if __name__ == "__main__":
    main()
