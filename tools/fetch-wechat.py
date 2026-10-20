#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/fetch-wechat.py —— 把一篇微信公众号文章拉进「荐读」（links/）

用法（在 personal-blog 目录下）：
    python tools/fetch-wechat.py <文章URL> <slug>

其中 slug 建议「日期-拼音」，例如 2026-08-09-ru-he-qu-chu-hua-wei-de-shen-xing。
脚本会：
  1. 抓页面，读出标题 / 作者 / 公众号名 / 发布日期；
  2. 按原文顺序抽出正文（段落、小标题、引用）与图片位置；
  3. 把图片下载到 images/<slug>/img_0N.jpg（不盗链微信图床，图床会失效）；
  4. 写出 links/<slug>.md：front-matter 填好，正文就位，note/tags 留空等你改。

⚠ 微信只对完整浏览器 UA 返回正文，UA 太短会被拦（只回 2KB 验证页）。
⚠ 版权：默认会把全文写进 public 仓库，只用于已授权或明确可转载的文章。

依赖：仅标准库（urllib / html.parser / re）。
"""
import sys, os, re, html, time, urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 微信编辑器版本多：有的用 <p>，有的整段裹在 <section> 里，所以都要认
BLOCK = {"p", "h1", "h2", "h3", "h4", "blockquote", "li", "section"}
# 文末推广块的常见开头，遇到就丢弃
PROMO = ("微信扫一扫", "关注该公众号", "喜欢此内容的人还喜欢", "延伸阅读",
         "轻点两下取消赞", "轻点两下取消在看", "扫描二维码", "长按二维码")


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="ignore")


def meta(page, pattern, default=""):
    m = re.search(pattern, page)
    return html.unescape(m.group(1)).strip() if m else default


class BodyParser(HTMLParser):
    """按顺序收集正文块：段落 / 小标题 / 引用 / 图片"""
    def __init__(self):
        super().__init__()
        self.blocks = []      # [{"t": "p"/"h2"/"quote"/"img", "v": ...}]
        self.stack = []       # [(tag, 收集到的文本片段)]
        self.in_content = False
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div" and a.get("id") == "js_content":
            self.in_content = True
            self.depth = 1
            return
        if not self.in_content:
            return
        if tag == "div":
            self.depth += 1
        if tag == "img":
            src = a.get("data-src") or a.get("src") or ""
            if "mmbiz" in src or src.startswith("http"):
                self._flush_text()
                self.blocks.append({"t": "img", "v": src})
        elif tag in BLOCK:
            self.stack.append([tag, []])

    def handle_endtag(self, tag):
        if not self.in_content:
            return
        if tag == "div":
            self.depth -= 1
            if self.depth <= 0:
                self.in_content = False
            return
        if tag in BLOCK and self.stack:
            # 找到最近一个同名块收尾
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    buf = self.stack[i:]
                    text = "".join("".join(parts) for _, parts in buf)
                    del self.stack[i:]
                    self._emit(tag, text)
                    break

    def handle_data(self, data):
        if not self.in_content:
            return
        # 正文里有些文字没有任何块级标签包裹，直接落在 <div> 里，
        # 这时补一个隐式的段落块，别把内容丢掉
        if not self.stack:
            self.stack.append(["p", []])
        self.stack[-1][1].append(data)

    def _flush_text(self):
        # 图片插进来之前，把未闭合的块按顺序收掉
        while self.stack:
            tag, parts = self.stack.pop()
            self._emit(tag, "".join(parts))

    def _emit(self, tag, text):
        text = re.sub(r"\s+", " ", html.unescape(text)).strip()
        if not text:
            return
        if any(p in text for p in PROMO):
            return
        if tag in ("h1", "h2", "h3", "h4"):
            self.blocks.append({"t": "h" + tag[1], "v": text})
        elif tag == "blockquote":
            self.blocks.append({"t": "quote", "v": text})
        else:
            self.blocks.append({"t": "p", "v": text})


def ext_of(url, data):
    m = re.search(r"wx_fmt=([a-z]+)", url)
    e = m.group(1) if m else ""
    if not e:
        head = data[:4]
        if head[:3] == b"\xff\xd8\xff":
            e = "jpeg"
        elif head[:4] == b"\x89PNG":
            e = "png"
        elif head[:3] == b"GIF":
            e = "gif"
        else:
            e = "jpeg"
    return "jpg" if e == "jpeg" else e


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    url, slug = sys.argv[1], sys.argv[2]

    print("抓取：", url)
    page = fetch(url)
    if len(page) < 50000:
        print("✗ 只拿到 %d 字节，多半被微信拦了（换个网络或稍后再试）" % len(page))
        sys.exit(2)

    title = meta(page, r'<meta property="og:title" content="([^"]*)"') or meta(page, r'<title>([^<]*)</title>')
    author = meta(page, r'var author = htmlDecode\("([^"]*)"\)') or meta(page, r'var author = "([^"]*)"')
    source = meta(page, r'var nickname = htmlDecode\("([^"]*)"\)')
    ct = meta(page, r'var ct = "(\d+)"')
    date = time.strftime("%Y-%m-%d", time.localtime(int(ct))) if ct else ""

    parser = BodyParser()
    parser.feed(page)

    img_dir = os.path.join(ROOT, "images", slug)
    os.makedirs(img_dir, exist_ok=True)

    out, n_img = [], 0
    for b in parser.blocks:
        if b["t"] == "img":
            n_img += 1
            name = "img_%02d" % n_img
            try:
                req = urllib.request.Request(b["v"], headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                ext = ext_of(b["v"], data)
                path = os.path.join(img_dir, name + "." + ext)
                with open(path, "wb") as f:
                    f.write(data)
                out.append("![图片%d](images/%s/%s.%s)" % (n_img, slug, name, ext))
                print("  图片 %s.%s  %d 字节" % (name, ext, len(data)))
            except Exception as e:
                print("  ⚠ 图片下载失败，已跳过：%s" % e)
            continue
        if b["t"].startswith("h"):
            out.append("#" * int(b["t"][1]) + " " + b["v"])
        elif b["t"] == "quote":
            out.append("> " + b["v"])
        else:
            out.append(b["v"])
        out.append("")

    body = "\n".join(out).strip() + "\n"
    md = (
        "---\n"
        "title: %s\n"
        "source: %s\n"
        "author: %s\n"
        "url: %s\n"
        "date: %s\n"
        "tags: \n"
        "note: \n"
        "---\n\n%s" % (title, source, author, url, date, body)
    )
    out_path = os.path.join(ROOT, "links", slug + ".md")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(md)

    print("✓ 已写出 %s" % os.path.relpath(out_path, ROOT))
    print("  标题：%s\n  来源：%s\n  作者：%s\n  日期：%s\n  正文块 %d 个，图片 %d 张"
          % (title, source, author, date, len(parser.blocks) - n_img, n_img))
    print("下一步：补 tags 与 note（你的一句话评语），然后 node tools/build-links.js")


if __name__ == "__main__":
    main()
