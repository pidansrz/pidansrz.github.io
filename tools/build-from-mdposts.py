# -*- coding: utf-8 -*-
"""
把 md_posts（416 篇带 front-matter 的 Markdown + 1983 张配图）整包重建进博客。

流程：
  1) 解析每篇 md：标题 / 日期 / 原文链接 / 正文 / 配图
  2) 清洗微信模板垃圾：头部关注标语、尾部「记得点在看/加星标/往期文章」推荐列表
  3) 同标题合并（公众号有重推的「旧文」、也有抓取失败的空壳版），取正文最完整的那一版
  4) 生成 <日期>-<拼音slug> 的草稿 id，逐篇写出 drafts/
  5) 配图按 images/<id>/cover.jpg + img_NN.jpg 归档，同时压缩（长边 1200、质量 75）
  6) 头图只做页面大图，不再重复出现在正文里

用法：
    python tools/build-from-mdposts.py            # 预演，不写文件
    python tools/build-from-mdposts.py --apply    # 真正执行
"""
import os, re, sys, json, shutil, io

from PIL import Image
from pypinyin import lazy_pinyin

HERE = os.path.dirname(os.path.abspath(__file__))
BLOG = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(BLOG), "_incoming", "md_posts")
DRAFTS = os.path.join(BLOG, "drafts")
IMAGES = os.path.join(BLOG, "images")

APPLY = "--apply" in sys.argv
STAMP = "20261009"
BACKUP_DRAFTS = os.path.join(os.path.dirname(BLOG), "_drafts-backup-" + STAMP)
BACKUP_IMAGES = os.path.join(os.path.dirname(BLOG), "_images-backup-" + STAMP)

MAX_W = 1200          # 长边上限
QUALITY = 75          # JPEG 质量
GIF_TO_JPEG_OVER = 2 * 1024 * 1024   # 超过 2MB 的 GIF 取首帧转 JPEG

# ---------- 微信模板垃圾（整行剔除）----------
RE_HEAD = [
    re.compile(r"^全世界只有不到"),
    re.compile(r"^[\d.]+\s*%\s*的人$"),
    re.compile(r"^关注了?皮蛋瘦肉舟$"),
    re.compile(r"^你真是个特别的人$"),
]
RE_BOILER = [
    re.compile(r"^记得点"),
    re.compile(r"^别忘了把公号加星标"),
    re.compile(r"^欢迎(关注)?留言参与讨论"),
    re.compile(r"^所有留言[，,]?我都会一一回复"),
    re.compile(r"^阅读原文$"),
    re.compile(r"^轻点两下取消"),
    re.compile(r"^微信扫一扫"),
    re.compile(r"^长按"),
    re.compile(r"^识别二维码"),
    re.compile(r"^点击上方"),
    re.compile(r"^预览时标签不可点"),
    re.compile(r"^内容来自"),
    re.compile(r"^声明[:：]"),
    re.compile(r"^版权归"),
    re.compile(r"^编辑\s*[｜|]"),
    re.compile(r"^排版\s*[｜|]"),
    re.compile(r"^责编\s*[｜|]"),
    re.compile(r"^投稿邮箱"),
    re.compile(r"^因为公众号平台更改了推送规则"),
    re.compile(r"^疑似违规删除"),
    re.compile(r"^（疑似违规删除"),
    re.compile(r"^无永久链接"),
]
RE_DEAD = re.compile(r"疑似违规删除|已下线|无永久链接")

# ---------- 小工具 ----------
def norm_title(t):
    """判定「是不是同一篇」用的归一化"""
    s = re.sub(r"[\u200B-\u200D\uFEFF\u00AD]", "", str(t or ""))
    s = re.sub(r"^[【\[][^】\]]{1,6}[】\]]\s*", "", s)
    s = re.sub(r"(?:[\s|｜▏丨]*(?:旧文新看|旧文|记者节旧文|观见|夜读|荐读|粥读|舟侃|粥爷)\s*)+$", "", s)
    s = re.sub(r"[\s　]+", "", s)
    s = re.sub(r"[，。？！：；、,.\"“”'‘’()（）《》<>「」『』\[\]【】!?:\-—…·~～|｜]", "", s)
    return s.lower()


def slugify(title, seq):
    """标题 → 拼音 slug；全英文/数字标题也能处理"""
    s = re.sub(r"\s+", "", str(title or ""))
    parts = lazy_pinyin(s)
    out = []
    for p in parts:
        p = re.sub(r"[^a-z0-9]", "", p.lower())
        if p:
            out.append(p)
    slug = re.sub(r"-{2,}", "-", "-".join(out)).strip("-")
    if not slug:
        slug = "post-%03d" % seq
    return slug[:70].strip("-")


def plain_len(body_lines):
    t = "\n".join(body_lines)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)
    t = re.sub(r"[*`#>\[\]（）()]", "", t)
    return len(re.sub(r"\s+", "", t))


def make_excerpt(body_lines):
    """取第一段像样的正文做摘要"""
    for ln in body_lines:
        s = ln.strip()
        if not s or s.startswith("!") or s.startswith(">"):
            continue
        s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)
        s = re.sub(r"\*\*?|`", "", s).strip()
        if len(s) < 12:
            continue
        if len(s) <= 46:
            return s
        cut = s[:46]
        for p in "。！？；，、":
            i = cut.rfind(p)
            if i >= 20:
                return cut[: i + 1]
        return cut + "…"
    return ""


def clean_body(lines, corpus_titles):
    out = []
    for ln in lines:
        s = ln.strip()
        if not s:
            out.append("")
            continue
        if s.startswith("# "):                # 标题行，页面会自己渲染
            continue
        if any(r.match(s) for r in RE_HEAD):
            continue
        if any(r.match(s) for r in RE_BOILER):
            continue
        if s == "往期文章":                    # 从这里往后全是推荐位
            break
        out.append(ln.rstrip())
    # 尾部的「往期文章标题列表」：连续若干行恰好等于本站某篇标题 → 一并砍掉
    while out:
        tail = [x for x in out if x.strip()]
        if not tail:
            break
        last = tail[-1].strip()
        if len(last) <= 30 and last in corpus_titles:
            idx = len(out) - 1
            while idx >= 0 and out[idx].strip() == "":
                idx -= 1
            del out[idx:]
        else:
            break
    # 压掉多余空行
    txt = "\n".join(out)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip("\n").split("\n") if txt else []


# ---------- 读源 ----------
def parse_md(path):
    raw = open(path, encoding="utf-8").read().replace("\r\n", "\n")
    meta, body = {}, raw
    m = re.match(r"^---\n(.*?)\n---\n?", raw, re.S)
    if m:
        for line in m.group(1).split("\n"):
            mm = re.match(r"^(\w+):\s*(.*)$", line)
            if mm:
                meta[mm.group(1)] = mm.group(2).strip().strip('"')
        body = raw[m.end():]
    return {
        "title": (meta.get("title") or "").strip(),
        "date": (meta.get("date") or "").strip()[:10],
        "url": (meta.get("original_url") or "").strip(),
        "body": body,
    }


files = sorted(f for f in os.listdir(SRC) if f.endswith(".md"))
recs = []
for f in files:
    d = parse_md(os.path.join(SRC, f))
    d["file"] = f
    d["seq"] = int(f.split("-")[0])
    d["lines"] = d["body"].split("\n")
    d["imgs"] = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", d["body"])
    recs.append(d)

corpus = set()
for r in recs:
    t = r["title"].strip()
    if t:
        corpus.add(t)
corpus |= set(re.sub(r"^[#\s]+", "", ln.strip()) for r in recs for ln in r["lines"][:6] if ln.strip().startswith("# "))

for r in recs:
    r["lines"] = clean_body(r["lines"], corpus)
    r["imgs"] = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", "\n".join(r["lines"]))
    r["len"] = plain_len(r["lines"])
    r["dead"] = bool(RE_DEAD.search(r["body"]))

print("解析 %d 篇；清洗后正文为空的 %d 篇" % (len(recs), sum(1 for r in recs if r["len"] == 0)))

# ---------- 同标题合并：取最完整的一版 ----------
groups = {}
for r in recs:
    groups.setdefault(norm_title(r["title"]), []).append(r)

picked = []
dropped_dup = 0
for key, items in groups.items():
    if len(items) == 1:
        picked.append(items[0])
        continue
    # 同名不一定是重复：公众号常常把旧文重新推一遍（日期不同、链接不同、篇幅相当）。
    # 只丢掉「残版」——失效抓取或只有几十字的空壳；真正的重推旧文要完整保留。
    good = [x for x in items if not x["dead"] and x["len"] >= 150]
    if not good:                       # 全是残版，留最长的一个
        good = [max(items, key=lambda x: (x["len"], -x["seq"]))]
    good.sort(key=lambda x: (x["date"], x["seq"]))
    picked.extend(good)
    dropped_dup += len(items) - len(good)
picked.sort(key=lambda x: (x["date"], x["seq"]))
print("剔除残版后：%d 篇（去掉 %d 个空壳/失效副本，保留 %d 组真正的重推旧文）"
      % (len(picked), dropped_dup, sum(1 for v in groups.values() if len(v) > 1)))

# 完全没内容也没图的，丢弃
dropped = [r for r in picked if r["len"] == 0 and not r["imgs"]]
picked = [r for r in picked if r not in dropped]
print("无正文且无图，判定为失效页，丢弃 %d 篇：%s" % (len(dropped), ", ".join(x["title"][:16] for x in dropped[:8])))

# ---------- 与现有草稿比对：旧版更完整的，保留旧版 ----------
old = {}
if os.path.isdir(DRAFTS):
    for f in os.listdir(DRAFTS):
        if not f.endswith(".md") or f.startswith("_") or f == "README.md":
            continue
        raw = open(os.path.join(DRAFTS, f), encoding="utf-8").read()
        t = (re.search(r"^title:\s*(.+)$", raw, re.M) or [None, ""])[1].strip()
        body = raw.split("\n---", 2)[-1]
        old[norm_title(t)] = {"file": f, "title": t, "len": plain_len(body.split("\n")), "raw": raw}

keep_old = []
final = []
for r in picked:
    o = old.get(norm_title(r["title"]))
    if o and o["len"] > r["len"] * 1.3:
        keep_old.append(o)
    else:
        final.append(r)
print("新包更优：%d 篇；沿用博客旧版（新包是残版）：%d 篇" % (len(final), len(keep_old)))
for o in keep_old[:10]:
    print("    沿用旧版：" + o["title"][:34])

# ---------- 生成 id ----------
used = set()
for r in final:
    slug = slugify(r["title"], r["seq"])
    pid = "%s-%s" % (r["date"], slug)
    n = 2
    while pid in used:
        pid = "%s-%s-%d" % (r["date"], slug, n)
        n += 1
    used.add(pid)
    r["id"] = pid

# ---------- 图片压缩归档 ----------
def has_real_alpha(im):
    if im.mode in ("RGBA", "LA"):
        a = im.getchannel("A")
        return a.getextrema()[0] < 255
    if im.mode == "P" and "transparency" in im.info:
        return True
    return False


def convert(src_rel, dst_rel):
    """压缩一张图，返回最终使用的相对路径（可能改扩展名）"""
    src = os.path.join(SRC, src_rel)
    dst = os.path.join(BLOG, dst_rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im = Image.open(src)
    im.load()
    fmt = (im.format or "").upper()

    if fmt == "GIF" and os.path.getsize(src) <= GIF_TO_JPEG_OVER:
        shutil.copy2(src, dst)
        return dst_rel

    if fmt == "GIF":                       # 超大 GIF：取首帧转 JPEG
        im = im.convert("RGB")
        fmt = "JPEG"

    if has_real_alpha(im):                 # 真用到了透明 → 保留 PNG
        if im.width > MAX_W:
            h = round(im.height * MAX_W / im.width)
            im = im.resize((MAX_W, h), Image.LANCZOS)
        im.save(dst, "PNG", optimize=True)
        return dst_rel

    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if im.width > MAX_W:
        h = round(im.height * MAX_W / im.width)
        im = im.resize((MAX_W, h), Image.LANCZOS)
    dst_jpg = os.path.splitext(dst_rel)[0] + ".jpg"
    im.save(os.path.join(BLOG, dst_jpg), "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return dst_jpg


plan_img = []
for r in final:
    body = "\n".join(r["lines"])
    imgs = r["imgs"]
    mapping = {}
    body_imgs = imgs[1:] if imgs else []     # 第一张是头图，提到页面大图，正文不再重复
    cover_dst = None
    if imgs:
        cover_src = imgs[0]
        ext = ".png" if cover_src.lower().endswith(".png") else ".jpg"
        cover_dst = "images/%s/cover%s" % (r["id"], ext)
        mapping[cover_src] = cover_dst
    for i, s in enumerate(body_imgs, 1):
        ext = ".png" if s.lower().endswith(".png") else ".jpg"
        mapping[s] = "images/%s/img_%02d%s" % (r["id"], i, ext)
    for s, d in mapping.items():
        plan_img.append((s, d))
    r["map"] = mapping
    r["cover"] = cover_dst or ""

print("待处理配图 %d 张" % len(plan_img))

if "--preview" in sys.argv:
    outdir = os.path.join(HERE, "_preview-drafts")
    os.makedirs(outdir, exist_ok=True)
    # 抽几篇有代表性的：长文、短文、纯图片贴
    samples = [r for r in final if r["len"] > 3000][:2] + \
              [r for r in final if 300 < r["len"] <= 800][:2] + \
              [r for r in final if r["len"] < 60 and r["imgs"]][:1]
    for r in samples:
        body = "\n".join(r["lines"])
        if r["imgs"]:
            first = r["imgs"][0]
            body = re.sub(r"^\s*!\[[^\]]*\]\(%s\)\s*\n?" % re.escape(first), "", body, count=1)
        fm = ["---", "title: %s" % r["title"], "date: %s" % r["date"],
              "excerpt: %s" % make_excerpt(r["lines"]), "cover: %s" % r["cover"],
              "coverAlt: %s" % r["title"], "id: %s" % r["id"], "---", ""]
        open(os.path.join(outdir, r["id"] + ".md"), "w", encoding="utf-8").write("\n".join(fm) + body.strip() + "\n")
        print("  预览：" + r["id"] + "  正文" + str(r["len"]) + "字  图" + str(len(r["imgs"])))
    print("→ " + outdir)
    sys.exit(0)

if not APPLY:
    print("\n—— 预演结束，未写任何文件。加 --apply 执行 ——")
    by_year = {}
    for r in final:
        by_year[r["date"][:4]] = by_year.get(r["date"][:4], 0) + 1
    print("最终篇数 %d（另有 %d 篇沿用旧版）%s" % (len(final), len(keep_old), sorted(by_year.items())))
    sys.exit(0)

# ---------- 执行 ----------
# 1) 备份旧 drafts / images
os.makedirs(BACKUP_DRAFTS, exist_ok=True)
moved = 0
for f in os.listdir(DRAFTS):
    if f.endswith(".md") and not f.startswith("_") and f != "README.md":
        shutil.move(os.path.join(DRAFTS, f), os.path.join(BACKUP_DRAFTS, f))
        moved += 1
print("✓ 旧草稿 %d 篇已备份到 %s" % (moved, os.path.relpath(BACKUP_DRAFTS, BLOG)))

og = os.path.join(IMAGES, "og-default.jpg")
og_tmp = None
if os.path.exists(og):
    og_tmp = os.path.join(BACKUP_DRAFTS, "_og-default.jpg")
    shutil.copy2(og, og_tmp)

if os.path.isdir(IMAGES):
    shutil.move(IMAGES, BACKUP_IMAGES)
    print("✓ 旧 images/ 已整体移到 %s" % os.path.relpath(BACKUP_IMAGES, BLOG))
os.makedirs(IMAGES, exist_ok=True)
if og_tmp:
    shutil.copy2(og_tmp, os.path.join(IMAGES, "og-default.jpg"))
    print("✓ 已保留 og-default.jpg")

# 2) 沿用旧版的那几篇：草稿 + 图片目录一并搬回来
for o in keep_old:
    shutil.copy2(os.path.join(BACKUP_DRAFTS, o["file"]), os.path.join(DRAFTS, o["file"]))
    m = re.search(r"^id:\s*(.+)$", o["raw"], re.M)
    if m:
        oldid = m.group(1).strip()
        sd = os.path.join(BACKUP_IMAGES, oldid)
        if os.path.isdir(sd):
            shutil.copytree(sd, os.path.join(IMAGES, oldid), dirs_exist_ok=True)
print("✓ 沿用旧版 %d 篇已就位（含各自配图）" % len(keep_old))

# 3) 处理图片（扩展名可能因压缩/透明通道判断而改变，用 src_to_final 记最终结果）
src_to_final = {}
done = 0
for src_rel, dst_rel in plan_img:
    try:
        src_to_final[src_rel] = convert(src_rel, dst_rel)
        done += 1
    except Exception as e:
        print("   ! 失败 %s: %s" % (src_rel, e))
        src_to_final[src_rel] = dst_rel
    if done % 400 == 0:
        print("   图片 %d/%d" % (done, len(plan_img)), flush=True)
print("✓ 配图处理完成 %d/%d" % (done, len(plan_img)))

# 4) 写草稿
written = 0
for r in final:
    body = "\n".join(r["lines"])
    for src_rel in r["imgs"]:
        dst_rel = src_to_final.get(src_rel)
        if dst_rel:
            body = body.replace("](%s)" % src_rel, "](%s)" % dst_rel)
    # 头图那一行从正文移除（已作为页面大图）
    if r["imgs"]:
        first = src_to_final.get(r["imgs"][0]) or r["imgs"][0]
        body = re.sub(r"^\s*!\[[^\]]*\]\(%s\)\s*\n?" % re.escape(first), "", body, count=1)
    body = re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"

    cover = src_to_final.get(r["imgs"][0], "") if r["imgs"] else ""
    fm = [
        "---",
        "title: %s" % r["title"],
        "date: %s" % r["date"],
        "excerpt: %s" % make_excerpt(r["lines"]),
        "cover: %s" % cover,
        "coverAlt: %s" % r["title"],
        "id: %s" % r["id"],
        "---",
        "",
    ]
    out = "\n".join(fm) + body
    with open(os.path.join(DRAFTS, r["id"] + ".md"), "w", encoding="utf-8") as f:
        f.write(out)
    written += 1
print("✓ 新草稿写入 %d 篇" % written)

stat = {"articles": len(final) + len(keep_old), "images": done}
json.dump(stat, open(os.path.join(HERE, "_build-stat.json"), "w"), indent=1)
print("\n完成。站点文章数将变为 %d 篇" % stat["articles"])
