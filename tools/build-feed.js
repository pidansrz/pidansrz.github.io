#!/usr/bin/env node
/* ===========================================================
 * tools/build-feed.js — 从 js/data.js 生成订阅源与站点地图
 *
 * 用法：在 personal-blog 目录下执行
 *     node tools/build-feed.js
 *
 * 产物：
 *     feed.xml       RSS 2.0 订阅源（含全文）
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
const FEED_LIMIT = 50;
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
  if (!m) return new Date().toUTCString();
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0)).toUTCString();
}
function postUrl(p) {
  return BASE + "/post.html?id=" + encodeURIComponent(p.id);
}

const newest = sorted.length ? sorted[0].date : new Date().toISOString().slice(0, 10);

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
  "  <copyright>" + xml("© " + SITE.startYear + "–" + new Date().getFullYear() + " " + SITE.author) + "</copyright>",
  "  <lastBuildDate>" + new Date().toUTCString() + "</lastBuildDate>",
  "  <generator>personal-blog/tools/build-feed.js</generator>",
  '  <atom:link href="' + xml(BASE + "/feed.xml") + '" rel="self" type="application/rss+xml"/>',
  items,
  "</channel>",
  "</rss>",
  ""
].join("\n");

fs.writeFileSync(path.join(ROOT, "feed.xml"), feed, "utf8");

/* ---------- sitemap.xml ---------- */
const staticPages = [
  { loc: BASE + "/", lastmod: newest, priority: "1.0" },
  { loc: BASE + "/archive.html", lastmod: newest, priority: "0.6" },
  { loc: BASE + "/about.html", lastmod: newest, priority: "0.4" }
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
console.log("✓ feed.xml      " + feedPosts.length + " 篇全文"
  + (sorted.length > feedPosts.length ? "（共 " + sorted.length + " 篇，按 FEED_LIMIT=" + FEED_LIMIT + " 截断）" : ""));
console.log("✓ sitemap.xml   " + (staticPages.length + postPages.length) + " 条网址");
console.log("✓ robots.txt");
console.log("  站点根地址：" + BASE);
if (!sorted.length) console.log("  （提示：POSTS 还是空的，先去 js/data.js 加文章）");
