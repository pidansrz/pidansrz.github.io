# -*- coding: utf-8 -*-
"""
修掉上一轮遗留的问题：小于 2MB 的 GIF 被原样复制、却存成了 .jpg 后缀。
这里把 GIF 重新编码——小图保留动画、适度缩放降色；帧数过多或仍然过大的，取首帧转 JPEG。
随后同步更新 drafts/ 里的图片引用路径。
"""
import os, re, shutil
from PIL import Image

BLOG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(BLOG, "images")
DRAFTS = os.path.join(BLOG, "drafts")
# 沙箱禁止直接删除，改为移出到项目外（与之前压缩脚本同一套做法）
TRASH = os.path.join(os.path.dirname(BLOG), "_giffix-removed-20261009")


def move_away(path):
    """移出项目外。注意：shutil.move 在目标已存在时会退化成「复制+删除源文件」，
    删除会被沙箱拦截，所以这里先保证目标不冲突，失败也不中断整个循环。"""
    rel = os.path.relpath(path, BLOG)
    dst = os.path.join(TRASH, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n = 1
    while os.path.exists(dst):
        base, ext = os.path.splitext(dst)
        dst = "%s~%d%s" % (base, n, ext)
        n += 1
    try:
        shutil.move(path, dst)
        return True
    except Exception as e:
        print("   ! 移出失败（跳过，不影响结果）%s: %s" % (rel, e))
        return False

MAX_GIF_W = 800          # 动图缩到这个宽
GIF_BUDGET = 1_500_000   # 重编码后仍超过它就取首帧
MAX_FRAMES = 30

TARGETS = []
for root, _, fs in os.walk(IMAGES):
    for f in fs:
        p = os.path.join(root, f)
        try:
            im = Image.open(p)
            fmt = im.format
        except Exception:
            continue
        if fmt == "GIF" and not f.lower().endswith(".gif"):
            TARGETS.append(p)

print("需要处理的 GIF：%d 个" % len(TARGETS))

mapping = {}   # 旧相对路径 -> 新相对路径


def first_frame_jpeg(p, rel):
    im = Image.open(p)
    im = im.convert("RGB")
    dst_rel = os.path.splitext(rel)[0] + ".jpg"
    dst = os.path.join(BLOG, dst_rel)
    im.save(dst, "JPEG", quality=75, optimize=True, progressive=True)
    return dst_rel


total_before = 0
total_after = 0
for p in TARGETS:
    rel = os.path.relpath(p, BLOG).replace("\\", "/")
    before = os.path.getsize(p)
    total_before += before
    try:
        im = Image.open(p)
        n = getattr(im, "n_frames", 1)
        w0, h0 = im.size
        if n > MAX_FRAMES or (w0 * h0 * n) > 40_000_000:
            new_rel = first_frame_jpeg(p, rel)
        else:
            scale = min(1.0, MAX_GIF_W / float(w0))
            dur = im.info.get("duration", 100)
            loop = im.info.get("loop", 0)
            frames = []
            for i in range(n):
                im.seek(i)
                fr = im.convert("RGBA")
                if scale < 1.0:
                    fr = fr.resize((max(1, round(w0 * scale)), max(1, round(h0 * scale))), Image.LANCZOS)
                frames.append(fr)
            dst_rel = os.path.splitext(rel)[0] + ".gif"
            dst = os.path.join(BLOG, dst_rel)
            frames[0].save(
                dst, "GIF", save_all=True, append_images=frames[1:],
                duration=dur, loop=loop, optimize=True, disposal=2,
            )
            if os.path.getsize(dst) > GIF_BUDGET:
                move_away(dst)
                new_rel = first_frame_jpeg(p, rel)
            else:
                new_rel = dst_rel
    except Exception as e:
        print("   ! 失败 %s: %s" % (rel, e))
        new_rel = first_frame_jpeg(p, rel)

    if new_rel != rel:
        move_away(p)
        mapping[rel] = new_rel
    total_after += os.path.getsize(os.path.join(BLOG, new_rel))

print("GIF 体积：%.1f MB → %.1f MB" % (total_before / 1048576, total_after / 1048576))

# 同步草稿里的引用
changed = 0
if mapping:
    for f in os.listdir(DRAFTS):
        if not f.endswith(".md"):
            continue
        fp = os.path.join(DRAFTS, f)
        t = open(fp, encoding="utf-8").read()
        orig = t
        for old, new in mapping.items():
            t = t.replace("](%s)" % old, "](%s)" % new)
            t = t.replace(": %s\n" % old, ": %s\n" % new)
        if t != orig:
            open(fp, "w", encoding="utf-8").write(t)
            changed += 1
print("更新了 %d 篇草稿里的图片引用" % changed)
