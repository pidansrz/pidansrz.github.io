#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""重算首页「这里常写」关键词云的覆盖篇数，写入 js/wordcloud-data.js。

词表是人工挑定的一组（见 WORDS），脚本只负责：
  1. 用 jieba 分词统计每个词出现在多少篇草稿里（df）；
  2. 按 df 降序（同分按字典序）写出数据文件。

为什么不让脚本自动选词：按 df 自动排序必然把「世界 / 生活 / 社会 / 现实」
这类任何文章都高频的通用词顶到最前面，选出来的词没有辨识度。

用法（需要 python + jieba）：
    python tools/gen-wordcloud.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(ROOT, "drafts")
OUT = os.path.join(ROOT, "js", "wordcloud-data.js")

# 人工挑定的词表（顺序无所谓，输出时按覆盖篇数重排）
WORDS = [
    "中国", "媒体", "新闻", "微信", "舆论",
    "公众", "记者", "数据", "互联网", "视频",
    "流量", "用户", "政策", "微博", "法律",
    "机构", "毕业", "直播", "舆情", "高考",
]

HEAD = """/* 首页右栏「这里常写」关键词云（自动生成，勿手改数字）
   生成：python tools/gen-wordcloud.py
   —— 词表人工挑定，篇数由草稿重算；数组顺序即字号顺序（覆盖篇数从高到低） */
window.WC_WORDS = [
"""
FOOT = "];\n"


def strip_md(text):
    """去掉 front-matter、图片、链接、HTML 与 Markdown 记号，只留正文文字。"""
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[#>*`_\-|]+", " ", text)
    return text


def main():
    try:
        import jieba.posseg as pseg
    except ImportError:
        sys.exit("缺少 jieba：pip install jieba")

    files = [f for f in sorted(os.listdir(DRAFTS))
             if f.endswith(".md") and not f.startswith("_") and f != "README.md"]
    if not files:
        sys.exit("drafts/ 里没有草稿")

    df = {w: 0 for w in WORDS}
    todo = set(WORDS)
    for name in files:
        with open(os.path.join(DRAFTS, name), encoding="utf-8") as fh:
            body = strip_md(fh.read())
        seen = set()
        for pair in pseg.cut(body):
            word = pair.word.strip()
            if word in todo:
                seen.add(word)
        for word in seen:
            df[word] += 1

    rows = sorted(WORDS, key=lambda w: (-df[w], w))
    body = "".join('  ["%s", %d],\n' % (w, df[w]) for w in rows)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEAD + body + FOOT)

    print("统计 %d 篇 → %s" % (len(files), os.path.relpath(OUT, ROOT)))
    for w in rows:
        print("  %-4s %3d" % (w, df[w]))


if __name__ == "__main__":
    main()
