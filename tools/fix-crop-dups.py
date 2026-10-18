#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
去掉「同一张照片存了两份、其中一份是另一份的裁剪」里的那张裁剪版。

规则（与用户要求一致：只留内容更完整的那一张）：
  1) 若被删的（裁剪版）是头图封面：
       - 把「更完整的那张」提为头图：若是 JPEG 就直接字节复制成 cover.jpg
         （不重编码，画质无损）；否则把 front-matter 的 cover 指向它；
       - 该图原本在正文里的引用一并删掉 —— 否则同一张还是会出现两次；
       - 旧的 cover.jpg 移出站点。
  2) 若被删的是正文配图：删掉正文引用，文件移出站点。
  3) 两边都是正文配图：删裁剪版那张。

输入：tools/_crop-confirmed.json
  [{"id": "<文章id>", "keep": "images/.../x.jpg", "drop": "images/.../y.jpg"}, ...]

用法：
  python tools/fix-crop-dups.py            # 试算，不改任何文件
  python tools/fix-crop-dups.py --apply    # 真正执行（先备份草稿、图片移出）
"""
import datetime
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

CONFIRMED = "tools/_crop-confirmed.json"
STAMP = datetime.date.today().strftime("%Y%m%d")
BACKUP_DRAFTS = os.path.join(ROOT, "..", "_cropdup-backup-" + STAMP, "drafts")
TRASH_IMAGES = os.path.join(ROOT, "..", "_cropdup-removed-" + STAMP)


def move_away(src, dst_root):
    """把文件移到站点外；目标已存在时加后缀，避免覆盖"""
    if not os.path.exists(src):
        return None
    dst = os.path.join(dst_root, src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    i = 1
    base, ext = os.path.splitext(dst)
    while os.path.exists(dst):
        dst = "%s.%d%s" % (base, i, ext)
        i += 1
    shutil.move(src, dst)
    return dst


def del_image_ref(text, rel):
    """删掉引用 rel 的那张图，返回 (新文本, 次数)"""
    esc = re.escape(rel)
    whole = re.compile(r"^[ \t]*!\[[^\]]*\]\(" + esc + r"\)[ \t]*\n?", re.M)
    new, n = whole.subn("", text)
    if n:
        new = re.sub(r"\n{3,}", "\n\n", new)
        return new, n
    inline = re.compile(r"!\[[^\]]*\]\(" + esc + r"\)")
    return inline.subn("", text)


def set_cover(text, newcover):
    return re.sub(r"^cover:.*$", "cover: " + newcover, text, count=1, flags=re.M)


def is_jpeg(p):
    return p.lower().endswith((".jpg", ".jpeg"))


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(CONFIRMED):
        sys.exit("缺少 %s" % CONFIRMED)
    items = json.load(open(CONFIRMED, encoding="utf-8"))

    drafts = {}
    for f in os.listdir("drafts"):
        if f.endswith(".md"):
            drafts[f] = open(os.path.join("drafts", f), encoding="utf-8").read()

    plan = []
    for it in items:
        pid, keep, drop = it["id"], it["keep"], it["drop"]
        fname = pid + ".md"
        if fname not in drafts:
            print("  ✗ 草稿不存在：%s" % fname)
            continue
        text = drafts[fname]
        cover = re.search(r"^cover:\s*(.*)$", text, re.M)
        cover = cover.group(1).strip() if cover else ""
        if drop not in text and drop != cover:
            print("  ✗ 草稿里找不到 %s（%s）" % (drop, fname))
            continue
        # 该图是否被别的草稿引用
        others = [f for f, t in drafts.items() if f != fname and drop in t]
        if others:
            print("  ! %s 被别的草稿引用，跳过：%s" % (drop, others))
            continue
        plan.append({"fname": fname, "pid": pid, "keep": keep, "drop": drop,
                     "cover": cover, "oldText": text})

    print("确认清单 %d 条，可执行 %d 条" % (len(items), len(plan)))
    kb = sum(os.path.getsize(p["drop"]) for p in plan if os.path.exists(p["drop"])) / 1024.0
    print("将移出图片 %d 个，合计 %.1f KB" % (sum(1 for p in plan if os.path.exists(p["drop"])), kb))
    for p in plan:
        role = "头图" if p["drop"] == p["cover"] else "正文"
        print("   %-46s  删[%s]%s   留 %s" % (
            p["pid"][:46], role, p["drop"].split("/")[-1], p["keep"].split("/")[-1]))
    if not apply:
        print("\n—— 试算结束（未改动任何文件）。确认无误后加 --apply ——")
        return

    os.makedirs(BACKUP_DRAFTS, exist_ok=True)
    os.makedirs(TRASH_IMAGES, exist_ok=True)

    changed = moved = 0
    for p in plan:
        text = p["oldText"]
        fname, keep, drop = p["fname"], p["keep"], p["drop"]
        pid = p["pid"]
        # 备份草稿（不覆盖已有快照）
        bdst = os.path.join(BACKUP_DRAFTS, fname)
        if not os.path.exists(bdst):
            shutil.copy2(os.path.join("drafts", fname), bdst)

        # 幂等：若更完整的那张(keep)已不在原地（上轮已移出/已处理），直接跳过，
        # 避免重复处理已完成项导致 FileNotFound。
        if not os.path.exists(keep):
            print("   ! 跳过（keep 已不在原地，疑似已处理）：%s %s" % (
                pid[:40], keep.split("/")[-1]))
            continue

        if drop == p["cover"]:
            # —— 被删的是头图（裁切版），把更完整的那张提升为头图 ——
            if os.path.exists(drop):                       # 先备份旧封面
                _trash_dst = os.path.join(TRASH_IMAGES, drop)
                os.makedirs(os.path.dirname(_trash_dst), exist_ok=True)
                shutil.copy2(drop, _trash_dst)
            if keep != drop:                               # 正文里对 keep 的引用一并去掉
                text, n = del_image_ref(text, keep)
                if n:
                    print("   · %s：正文中 %s 的引用一并去掉（%d 处）" % (
                        pid[:40], keep.split("/")[-1], n))
            if is_jpeg(keep):
                tmp = os.path.join(ROOT, "..", "_cropdup-tmp-cover.jpg")
                shutil.copy2(keep, tmp)
                shutil.move(tmp, drop)                     # 字节覆盖 cover.jpg，不重编码
                move_away(keep, TRASH_IMAGES)
                moved += 1
                print("   ✓ %s：cover.jpg ← %s（原封面已备份）" % (pid[:40], keep.split("/")[-1]))
            else:
                text = set_cover(text, keep)
                move_away(drop, TRASH_IMAGES)
                moved += 1
                print("   ✓ %s：cover 指向 %s（非 JPEG，文件留在原位）" % (pid[:40], keep))
        else:
            text, n = del_image_ref(text, drop)
            if not n:
                print("   ✗ %s：未匹配到 %s 的图片行" % (fname, drop))
                continue
            move_away(drop, TRASH_IMAGES)
            moved += 1
            print("   ✓ %s：删掉正文里的裁剪图 %s" % (pid[:40], drop.split("/")[-1]))

        open(os.path.join("drafts", fname), "w", encoding="utf-8", newline="\n").write(text)
        changed += 1

    print("\n✓ 已修改草稿 %d 篇，移出图片 %d 个" % (changed, moved))
    print("   草稿备份：%s" % os.path.relpath(BACKUP_DRAFTS, ROOT))
    print("   图片移出：%s" % os.path.relpath(TRASH_IMAGES, ROOT))
    print("\n下一步：")
    print("  node tools/import-posts.js --replace")
    print("  python tools/add-image-sizes.py --apply")
    print("  node tools/mark-reposts.js --apply")
    print("  node tools/verify.js")


if __name__ == "__main__":
    main()
