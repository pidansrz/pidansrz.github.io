/* ===========================================================
 * tools/md.js — Markdown / front-matter 转换的公共工具
 *
 * 原来这些函数都写在 import-posts.js 里。为了让「荐读（links/）」这类
 * 新的内容源也能用同一套 Markdown 语法和转义规则，抽出来共用：
 *   · import-posts.js  主博客文章
 *   · build-links.js   荐读（好文收藏）
 * 两边用同一份实现，排版才不会跑偏。
 *
 * 零依赖，只用 Node 内置模块。
 * =========================================================== */

/* ---------- 转义 ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}
function pad(n) { return n < 10 ? "0" + n : "" + n; }

/* ---------- front-matter 解析（简化 YAML：只支持 key: value）---------- */
function splitFrontMatter(src) {
  src = String(src).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!/^---\s*\n/.test(src)) return { meta: {}, body: src };
  const end = src.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: src };
  const head = src.slice(3, end);
  const body = src.slice(src.indexOf("\n", end + 1) + 1);
  const meta = {};
  head.split("\n").forEach(function (line) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) return;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v === "true") v = true;
    else if (v === "false") v = false;
    meta[m[1]] = v;
  });
  return { meta: meta, body: body };
}

/* ---------- 行内 Markdown ---------- */
function inline(t) {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, alt, url) {
    return '<img src="' + escAttr(url) + '" alt="' + escAttr(alt) + '">';
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, url) {
    return '<a href="' + escAttr(url) + '">' + text + "</a>";
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

/* ---------- 块级 Markdown → HTML ---------- */
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;      // "ul" | "ol"
  let items = [];
  let quote = [];

  function flushPara() {
    if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
  }
  function flushList() {
    if (list && items.length) {
      out.push("<" + list + ">" + items.map(function (i) { return "<li>" + inline(i) + "</li>"; }).join("") + "</" + list + ">");
    }
    list = null; items = [];
  }
  function flushQuote() {
    if (quote.length) { out.push("<blockquote>" + inline(quote.join(" ")) + "</blockquote>"); quote = []; }
  }
  function flushAll() { flushPara(); flushList(); flushQuote(); }

  lines.forEach(function (raw) {
    const line = raw.trim();

    if (!line) { flushAll(); return; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushAll(); out.push("<hr>"); return; }

    // 图片独占一行 → 直接输出 img（CSS 已为其设上下留白）
    const imgOnly = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(line);
    if (imgOnly) {
      flushAll();
      out.push('<img src="' + escAttr(imgOnly[2]) + '" alt="' + escAttr(imgOnly[1]) + '">');
      return;
    }

    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      const lv = Math.min(h[1].length, 4);
      out.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">");
      return;
    }

    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      quote.push(line.replace(/^>\s?/, ""));
      return;
    }

    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara(); flushQuote();
      const kind = ul ? "ul" : "ol";
      if (list && list !== kind) flushList();
      list = kind;
      items.push((ul || ol)[1]);
      return;
    }

    // 公众号导出的正文里，段落之间常常只剩一个换行（中间的空行在导出环节丢了），
    // 所以这里「一行 = 一段」：绝不能把连续几行合并成一段，否则正文所有段落会粘成一坨。
    flushList(); flushQuote();
    flushPara();
    out.push("<p>" + inline(line) + "</p>");
  });

  flushAll();
  return out.join("\n");
}

/* ---------- 摘要 ---------- */
function makeExcerpt(html) {
  const m = /<p>([\s\S]*?)<\/p>/.exec(html);
  let text = m ? m[1] : html;
  text = text.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= 110) return text;
  const cut = text.slice(0, 110);
  const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("，"), cut.lastIndexOf(" "));
  return (stop > 60 ? cut.slice(0, stop) : cut) + "……";
}

/* ---------- HTML → 纯文本（搜索索引用）---------- */
function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  esc: esc,
  escAttr: escAttr,
  pad: pad,
  splitFrontMatter: splitFrontMatter,
  inline: inline,
  mdToHtml: mdToHtml,
  makeExcerpt: makeExcerpt,
  plainText: plainText,
};
