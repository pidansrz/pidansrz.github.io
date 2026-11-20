#!/usr/bin/env node
/* ===========================================================
 * tools/build-feed.js — 从 js/data.js 生成订阅源与站点地图
 *
 * 用法：在 personal-blog 目录下执行
 *     node tools/build-feed.js
 *
 * 产物：
 *     feed.xml       RSS 2.0 订阅源（含全文；纯 XML，不挂 XSLT）
 *     feed.html      给人看的订阅引导页（简介 + 订阅说明 + 全部文章列表）
 *     sitemap.xml    站点地图（给搜索引擎）
 *     robots.txt     收录规则（指向 sitemap）
 *
 * 零依赖，只用 Node 内置模块。改完文章记得重跑一次。
 * =========================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* ---------- 读取文章数据 ---------- */
const dataPath = path.join(ROOT, "js", "data.js");
let SITE, POSTS;

try {
  const src = fs.readFileSync(dataPath, "utf8");
  // data.js 声明的是顶层 const，放进函数作用域里求值再取出来
  const api = new Function(src + "\n;return { SITE: SITE, POSTS: POSTS };")();
  SITE = api.SITE;
  POSTS = api.POSTS;
} catch (err) {
  console.error("✗ 读取 js/data.js 失败：" + err.message);
  process.exit(1);
}

if (!SITE || !Array.isArray(POSTS)) {
  console.error("✗ js/data.js 里没找到 SITE 或 POSTS");
  process.exit(1);
}

/* ---------- 基础信息 ---------- */
const BASE = String(SITE.url || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(BASE)) {
  console.error("✗ SITE.url 看起来不是完整网址，请在 js/data.js 里填写，例如 https://example.com");
  process.exit(1);
}

const sorted = POSTS.slice().sort(function (a, b) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
});

/* RSS 只放最近 N 篇全文。
   文章多的时候（比如上百篇），全文订阅源会到 1MB 级别，
   阅读器每次拉取都很慢。业界惯例也是只给最近几十篇。
   站点地图仍然收录全部文章，不影响搜索引擎收录。想改就改这个数字。 */
const FEED_LIMIT = Infinity;          // 全量输出：所有文章都进 feed（不止最近 50 篇）
const feedPosts = sorted.slice(0, FEED_LIMIT);

/* ---------- 工具 ---------- */
function xml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
  });
}
function cdata(s) {
  // 正文包进 CDATA，保留 <p> <h2> 等原始标签
  return "<![CDATA[" + String(s == null ? "" : s).replace(/]]>/g, "]]]]><![CDATA[>") + "]]>";
}
function rfc822(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  // 日期不合法时退回一个固定值，保证输出可复现（不能用 new Date()，否则每次构建都不同）
  if (!m) return new Date(Date.UTC(1970, 0, 1)).toUTCString();
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0)).toUTCString();
}
function postUrl(p) {
  // 指向构建生成的规范静态页 post/<id>.html（带正确的绝对头图，供爬虫/分享读取）
  return BASE + "/post/" + encodeURIComponent(p.id) + ".html";
}

const newest = sorted.length ? sorted[0].date : new Date().toISOString().slice(0, 10);

/* 构建时间与版权年份都取「最新文章日期」，而不是当前时间。
   否则本地和 CI 各构建一次，feed.xml 的时间戳必然不同 → git 合并时天天冲突。
   同样的内容必须产出同样的文件，这是能自动提交回仓库的前提。 */
const buildDate = rfc822(newest);
const copyYear = Math.max(Number(SITE.startYear) || 0, Number(String(newest).slice(0, 4)) || 0);

/* ---------- feed.xml（仅最近 FEED_LIMIT 篇）---------- */
const items = feedPosts.map(function (p) {
  const body = p.content || "<p>" + (p.excerpt || "") + "</p>";
  return [
    "  <item>",
    "    <title>" + xml(p.title) + "</title>",
    "    <link>" + xml(postUrl(p)) + "</link>",
    '    <guid isPermaLink="true">' + xml(postUrl(p)) + "</guid>",
    "    <pubDate>" + rfc822(p.date) + "</pubDate>",
    "    <category>" + xml(p.date.slice(0, 4)) + "</category>",
    "    <author>" + xml(SITE.author) + "</author>",
    "    <description>" + cdata(p.excerpt || "") + "</description>",
    "    <content:encoded>" + cdata(body) + "</content:encoded>",
    "  </item>"
  ].join("\n");
}).join("\n");

const feed = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0"',
  '     xmlns:atom="http://www.w3.org/2005/Atom"',
  '     xmlns:content="http://purl.org/rss/1.0/modules/content/">',
  "<channel>",
  "  <title>" + xml(SITE.title) + "</title>",
  "  <link>" + xml(BASE + "/") + "</link>",
  "  <description>" + xml(SITE.bio || SITE.subtitle || SITE.title) + "</description>",
  "  <language>zh-CN</language>",
  "  <copyright>" + xml("© " + SITE.startYear + "–" + copyYear + " " + SITE.author) + "</copyright>",
  "  <lastBuildDate>" + buildDate + "</lastBuildDate>",
  "  <generator>personal-blog/tools/build-feed.js</generator>",
  '  <atom:link href="' + xml(BASE + "/feed.xml") + '" rel="self" type="application/rss+xml"/>',
  items,
  "</channel>",
  "</rss>",
  ""
].join("\n");

fs.writeFileSync(path.join(ROOT, "feed.xml"), feed, "utf8");

/* ---------- feed.html：给人看的订阅引导页 ----------
   以前靠 feed.xml 里的 <?xml-stylesheet?> 挂 XSL 在浏览器里渲染出漂亮列表，
   但 Chrome/Edge 正在弃用 XSLT（打开就弹红条，将来直接移除）。
   改成真正的静态 HTML：样式照搬原 XSL，明暗跟随站点主题。
   feed.xml 回归纯 RSS，只给阅读器用。 */
const feedCss = [
  ":root {",
  "  --maxw: 720px; --bg: #fcfbf8; --surface: #ffffff;",
  "  --text: #1e1d1b; --text-2: #5e5a54; --text-3: #767061;",
  "  --rule: #e5e2db; --accent: #8c3a3a; --code-bg: #f1eee9;",
  "}",
  ':root[data-theme="dark"] {',
  "  --bg: #151514; --surface: #1c1c1a;",
  "  --text: #dedad3; --text-2: #a09b93; --text-3: #8d887f;",
  "  --rule: #2e2e2b; --accent: #cb8f8f; --code-bg: #232320;",
  "}",
  "* { box-sizing: border-box; }",
  "body { margin:0; background:var(--bg); color:var(--text);",
  '  font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }',
  ".wrap { max-width:var(--maxw); margin:0 auto; padding:52px 20px 72px; }",
  "h1 { font-size:1.6rem; margin:0 0 8px; letter-spacing:.02em; }",
  ".bio { color:var(--text-2); margin:0 0 10px; }",
  ".hint { color:var(--text-3); font-size:.9rem; margin:0 0 30px; line-height:1.6; }",
  ".hint code { background:var(--code-bg); color:var(--text-2); padding:2px 6px;",
  "  border-radius:4px; font-size:.85em; white-space:nowrap; }",
  ".hint a { color:var(--accent); }",
  "ol { list-style:none; margin:0; padding:0; border-top:1px solid var(--rule); }",
  "li { border-bottom:1px solid var(--rule); padding:18px 0; }",
  ".date { color:var(--text-3); font-size:.8rem; letter-spacing:.05em; }",
  "a { color:var(--accent); text-decoration:none; }",
  "a:hover { text-decoration:underline; }",
  ".t { font-size:1.1rem; font-weight:600; display:block; margin:3px 0 5px; }",
  ".ex { color:var(--text-2); font-size:.92rem; }",
  ".ex p { margin:0; }",
  ".nav { margin:0 0 26px; font-size:.85rem; color:var(--text-3); }",
  ".nav a { color:var(--text-3); }",
  ".nav a:hover { color:var(--accent); }",
  "@media (max-width: 520px) {",
  "  .wrap { padding:34px 16px 56px; }",
  "  h1 { font-size:1.4rem; }",
  "}"
].join("\n");

const feedRows = feedPosts.map(function (p) {
  return [
    "      <li>",
    '        <span class="date">' + xml(p.date) + "</span>",
    '        <a class="t" href="' + xml(postUrl(p)) + '">' + xml(p.title) + "</a>",
    '        <span class="ex">' + xml(p.excerpt || "") + "</span>",
    "      </li>"
  ].join("\n");
}).join("\n");

const feedHtml = [
  "<!DOCTYPE html>",
  '<html lang="zh-CN" data-theme="light">',
  "<head>",
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>" + xml(SITE.title) + " · RSS 订阅</title>",
  '<meta name="description" content="' + xml(SITE.bio || SITE.title) + '">',
  '<link rel="canonical" href="' + xml(BASE + "/feed.html") + '">',
  '<link rel="alternate" type="application/rss+xml" title="' + xml(SITE.title) + '" href="feed.xml">',
  '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>舟</text></svg>">',
  '<script src="js/theme.js"></script>',
  "<style>\n" + feedCss + "\n</style>",
  "</head>",
  "<body>",
  '<div class="wrap">',
  '<p class="nav"><a href="index.html">← 返回首页</a>　·　<a href="archive.html">归档</a></p>',
  "<h1>" + xml(SITE.title) + "</h1>",
  '<p class="bio">' + xml(SITE.bio || SITE.title) + "</p>",
  '<p class="hint">这是一个 RSS 2.0 订阅源。复制地址 <code>' + xml(BASE + "/feed.xml") +
    "</code> 到 RSS 阅读器（Feedly / Inoreader / NetNewsWire / Reeder 等）即可订阅，新文章会自动送达。下方是站内全部文章列表（最新在前，共 " +
    feedPosts.length + " 篇）。</p>",
  "    <ol>",
  feedRows,
  "    </ol>",
  "</div>",
  "</body>",
  "</html>",
  ""
].join("\n");

fs.writeFileSync(path.join(ROOT, "feed.html"), feedHtml, "utf8");

/* ---------- sitemap.xml ---------- */
const staticPages = [
  { loc: BASE + "/", lastmod: newest, priority: "1.0" },
  { loc: BASE + "/archive.html", lastmod: newest, priority: "0.6" },
  { loc: BASE + "/about.html", lastmod: newest, priority: "0.4" },
  { loc: BASE + "/feed.html", lastmod: newest, priority: "0.3" }
];
const postPages = sorted.map(function (p) {
  return { loc: postUrl(p), lastmod: p.date, priority: "0.8" };
});

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
].concat(
  staticPages.concat(postPages).map(function (u) {
    return "  <url>\n    <loc>" + xml(u.loc) + "</loc>\n    <lastmod>" + u.lastmod + "</lastmod>\n    <priority>" + u.priority + "</priority>\n  </url>";
  })
).concat(["</urlset>", ""]).join("\n");

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemap, "utf8");

/* ---------- robots.txt ---------- */
const robots = [
  "User-agent: *",
  "Allow: /",
  "",
  "Sitemap: " + BASE + "/sitemap.xml",
  ""
].join("\n");

fs.writeFileSync(path.join(ROOT, "robots.txt"), robots, "utf8");

/* ---------- 汇报 ---------- */
console.log("✓ feed.xml      " + feedPosts.length + " 篇全文（纯 RSS，无 XSLT）"
  + (sorted.length > feedPosts.length ? "（共 " + sorted.length + " 篇，按 FEED_LIMIT=" + FEED_LIMIT + " 截断）" : ""));
console.log("✓ feed.html     " + feedPosts.length + " 篇的订阅引导页");
console.log("✓ sitemap.xml   " + (staticPages.length + postPages.length) + " 条网址");
console.log("✓ robots.txt");
console.log("  站点根地址：" + BASE);
if (!sorted.length) console.log("  （提示：POSTS 还是空的，先去 js/data.js 加文章）");
