#!/usr/bin/env node
/* ===========================================================
 * tools/build-links.js — 「荐读」（好文收藏）的构建脚本
 *
 * 数据源：links/*.md
 *   front-matter：title / source / author / url / date / tags / note
 *   正文：全文 Markdown（存档）
 *   ⚠ 以 _ 开头的文件和 README.md 不收录（可当模板放在里面）
 *
 * 产出：
 *   js/links-data.js   列表页与导航用的元信息（不含全文，首屏很轻）
 *   js/links-text.js   全文纯文本，供站内搜索懒加载
 *   links/<id>.html    每篇一个静态详情页：全文 HTML + 原文链接/来源署名
 *                      + 绝对路径 og（微信分享可读）+ <base href="/">
 *
 * 与主博客完全独立：不动 drafts/、不动 js/data.js、不影响 407 篇文章。
 *
 * 用法：node tools/build-links.js（已并入 build-all.js）
 * =========================================================== */

const fs = require("fs");
const path = require("path");
const { splitFrontMatter, mdToHtml, plainText } = require("./md.js");

const ROOT = path.join(__dirname, "..");
const LINKS_DIR = path.join(ROOT, "links");
const OUT_DIR = path.join(ROOT, "links");
const OUT_DATA = path.join(ROOT, "js", "links-data.js");
const OUT_TEXT = path.join(ROOT, "js", "links-text.js");

/* ---------- 站点信息（og/canonical 要用绝对地址）---------- */
let SITE = {};
try {
  const src = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  const api = new Function(src + "\n;return { SITE: SITE };")();
  SITE = api.SITE || {};
} catch (err) {
  console.warn("⚠ 读取 js/data.js 的 SITE 失败，分享图将用相对路径：" + err.message);
}
const BASE = String(SITE.url || "").replace(/\/+$/, "");

function escMeta(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
/* 抓取方（微信/社交平台）只认绝对地址 */
function abs(p) {
  if (!p) return "";
  if (/^https?:/i.test(p)) return p;
  return BASE ? BASE + "/" + String(p).replace(/^\.?\//, "") : String(p);
}

/* ---------- 读取 links/*.md ---------- */
let files = [];
try {
  files = fs.readdirSync(LINKS_DIR).filter(function (f) {
    return /\.md$/i.test(f) && !/^_/.test(f) && f !== "README.md";
  });
} catch (err) {
  console.warn("⚠ 没有 links/ 目录，本次生成空的荐读数据");
}

const links = [];
for (const f of files.sort()) {
  const raw = fs.readFileSync(path.join(LINKS_DIR, f), "utf8").replace(/\r\n/g, "\n");
  const { meta, body } = splitFrontMatter(raw);
  const id = f.replace(/\.md$/i, "");
  const contentHtml = mdToHtml(body);
  const text = plainText(contentHtml);
  const tags = String(meta.tags || "")
    .replace(/^\[|\]$/g, "")
    .split(/[,，]/)
    .map(function (t) { return t.trim(); })
    .filter(Boolean);

  links.push({
    id: id,
    title: String(meta.title || id),
    source: String(meta.source || ""),
    author: String(meta.author || ""),
    url: String(meta.url || ""),
    date: String(meta.date || ""),
    tags: tags,
    note: String(meta.note || ""),
    minutes: Math.max(1, Math.round(text.length / 320)),
    content: contentHtml,
    text: text,
  });
}

links.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

/* ---------- 1. js/links-data.js（列表页用，不含全文）---------- */
const metaOnly = links.map(function (l) {
  return {
    id: l.id, title: l.title, source: l.source, author: l.author,
    url: l.url, date: l.date, tags: l.tags, note: l.note, minutes: l.minutes,
  };
});
const dataSrc =
  '/* 由 tools/build-links.js 自动生成（源自 links/*.md），请勿手改。\n' +
  '   荐读（好文收藏）列表数据：不含全文，全文在各 links/<id>.html 里。 */\n' +
  "var LINKS = " + JSON.stringify(metaOnly, null, 0) + ";\n";
writeIfChanged(OUT_DATA, dataSrc);

/* ---------- 2. js/links-text.js（全文纯文本，搜索时懒加载）---------- */
const textMap = {};
links.forEach(function (l) { textMap[l.id] = l.text; });
const textSrc =
  "/* 由 tools/build-links.js 自动生成：荐读全文的纯文本索引（搜索时懒加载） */\n" +
  "window.LINK_TEXT = " + JSON.stringify(textMap) + ";\n";
writeIfChanged(OUT_TEXT, textSrc);

/* ---------- 3. links/<id>.html 静态详情页 ---------- */
const OG_DEFAULT = abs("images/og-default.jpg");
let made = 0;
for (const l of links) {
  const pageTitle = l.title + " · " + (SITE.title || "荐读");
  const desc = l.note || (l.source ? "收藏自" + l.source : "");
  const canonical = BASE ? BASE + "/links/" + encodeURIComponent(l.id) + ".html" : "links/" + l.id + ".html";
  const ogImage = OG_DEFAULT;

  const originBits = [];
  if (l.url) {
    originBits.push(
      '<a class="link-origin-url" href="' + escMeta(l.url) + '" target="_blank" rel="noopener noreferrer">' +
        "阅读原文 ↗</a>"
    );
  }
  if (l.source) originBits.push("<span>来源：" + escMeta(l.source) + "</span>");
  if (l.author) originBits.push("<span>作者：" + escMeta(l.author) + "</span>");
  if (l.date) originBits.push("<span>收录于 " + escMeta(l.date) + "</span>");

  const html =
    "<!DOCTYPE html>\n<html lang=\"zh-CN\" data-theme=\"light\">\n<head>\n" +
    '<meta charset="UTF-8">\n<base href="/">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    "<title>" + escMeta(pageTitle) + "</title>\n" +
    '<meta name="description" content="' + escMeta(desc) + '">\n' +
    '<link rel="canonical" href="' + canonical + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="' + escMeta(SITE.title || "") + '">\n' +
    '<meta property="og:locale" content="zh_CN">\n' +
    '<meta property="og:title" content="' + escMeta(pageTitle) + '">\n' +
    '<meta property="og:description" content="' + escMeta(desc) + '">\n' +
    '<meta property="og:image" content="' + ogImage + '">\n' +
    '<meta property="og:url" content="' + canonical + '">\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + escMeta(pageTitle) + '">\n' +
    '<meta name="twitter:image" content="' + ogImage + '">\n' +
    '<link rel="stylesheet" href="css/style.css">\n' +
    "<link rel=\"icon\" href=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>舟</text></svg>\">\n" +
    '<script src="js/theme.js"></script>\n' +
    "</head>\n<body data-page=\"link\">\n\n" +
    '<header id="site-header"></header>\n\n' +
    '<main class="post-page">\n  <div class="wrap">\n' +
    '    <article class="article link-article" data-link-id="' + escMeta(l.id) + '">\n' +
    '      <p class="article-meta link-origin">' + originBits.join("　·　") + "</p>\n" +
    '      <h1 class="link-title">' + escMeta(l.title) + "</h1>\n" +
    (l.note ? '      <p class="link-note">' + escMeta(l.note) + "</p>\n" : "") +
    (l.tags.length
      ? '      <p class="link-tags">' + l.tags.map(function (t) { return '<span class="link-tag">' + escMeta(t) + "</span>"; }).join("") + "</p>\n"
      : "") +
    '      <div class="article-body">\n' + l.content + "\n      </div>\n" +
    "    </article>\n  </div>\n</main>\n\n" +
    '<footer id="site-footer"></footer>\n\n' +
    '<div class="float-tools" id="floatTools" role="navigation" aria-label="页面快捷工具"></div>\n\n' +
    '<script src="js/index-data.js"></script>\n' +
    '<script src="js/links-data.js"></script>\n' +
    '<script src="js/app.js"></script>\n' +
    "</body>\n</html>\n";

  const out = path.join(OUT_DIR, encodeURIComponent(l.id) + ".html");
  writeIfChanged(out, html);
  made++;
}

console.log("✓ 荐读构建完成：" + links.length + " 条（生成 " + made + " 个详情页）");
console.log("  js/links-data.js  列表元信息（首屏）");
console.log("  js/links-text.js  全文纯文本（搜索用）");
console.log("  links/<id>.html   静态详情页（含原文链接与来源署名）");
if (BASE) console.log("  站点根地址：" + BASE);

/* ---------- 工具：内容没变就不重写（保证可复现、不产生无意义 diff）---------- */
function writeIfChanged(file, content) {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
  } catch (err) { /* 读不到就当作需要写 */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return true;
}
