#!/usr/bin/env node
/* ===========================================================
 * tools/build-posts.js — 为每篇文章生成独立静态页 post/<id>.html
 *
 * 为什么需要它：
 *   博客是 SPA 单页（post.html 靠 ?id= + JS 渲染）。微信/社交平台
 *   的分享爬虫不执行 JS，只读静态 HTML 里的 <meta property="og:*">，
 *   所以之前所有文章分享出去都是同一张默认图。
 *   本脚本给每篇文章产出一份「静态页」，把该篇的标题/描述/绝对路径
 *   头图直接写进 <meta>，爬虫无需跑 JS 就能读到每篇文章自己的头图。
 *
 * 关键技巧：在 <head> 注入 <base href="SITE.url/">。
 *   这样模板里所有相对路径（css/js/images）都按站点根目录解析，
 *   静态页即使位于 post/ 子目录也无需改写任何资源或图片路径；
 *   同时注入 window.__POST_ID__，让 app.js 直接定位文章（无需 ?id=）。
 *
 * 用法：在 personal-blog 目录下执行
 *     node tools/build-posts.js
 * 零依赖，只用 Node 内置模块。改完文章记得跑一次（已并入 build-all.js）。
 * =========================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* ---------- 读取文章数据 ---------- */
const dataPath = path.join(ROOT, "js", "data.js");
let SITE, POSTS;
try {
  const src = fs.readFileSync(dataPath, "utf8");
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

const BASE = String(SITE.url || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(BASE)) {
  console.error("✗ SITE.url 看起来不是完整网址，请在 js/data.js 里填写，例如 https://example.com");
  process.exit(1);
}

const sorted = POSTS.slice().sort(function (a, b) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
});

/* 读取 post.html 作为模板（手写静态文件，不被其它构建覆盖） */
const tplPath = path.join(ROOT, "post.html");
let tpl;
try {
  tpl = fs.readFileSync(tplPath, "utf8");
} catch (err) {
  console.error("✗ 找不到 post.html 模板：" + err.message);
  process.exit(1);
}

const outDir = path.join(ROOT, "post");
fs.mkdirSync(outDir, { recursive: true });

function escMeta(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
/* 相对路径转绝对地址：抓取方（社交平台）只认绝对 URL */
function abs(p) {
  if (!p) return "";
  if (/^https?:/i.test(p)) return p;
  return BASE + "/" + String(p).replace(/^\.?\//, "");
}
/* 没有头图（或占位封面）的文章，分享图回退到站点默认图 */
function isPlaceholderCover(cover) {
  return !cover || /shoe-repair-stall/.test(String(cover));
}

let count = 0;
let skipped = 0;
for (const p of sorted) {
  const id = p.id;
  if (!id) { skipped++; continue; }

  const cover = isPlaceholderCover(p.cover) ? "images/og-default.jpg" : p.cover;
  const ogImage = abs(cover);
  const title = (p.title || "") + " · " + (SITE.title || "");
  const desc = p.excerpt || SITE.subtitle || SITE.bio || "";
  const canonical = BASE + "/post/" + encodeURIComponent(id) + ".html";

  let html = tpl;

  // 1) <base href="/">：让模板里所有相对路径按「站点根」解析（子目录也不怕）；
  //    用 / 而不是写死域名，换域名或本地起服务都不必重新生成。
  html = html.replace(
    /(<meta charset="UTF-8">)/,
    '$1\n  <base href="/">'
  );

  // 2) 标题 + 普通 description（SEO/一致）
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    "<title>" + escMeta(title) + "</title>"
  );
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    '<meta name="description" content="' + escMeta(desc) + '">'
  );

  // 3) 分享 meta 整段替换（注释行 + og/twitter）
  html = html.replace(
    /<!-- 分享卡片：[\s\S]*?twitter:image" content="[^"]*">/,
    `<!-- 本文静态分享信息：供微信/社交爬虫直接读取，无需执行 JS -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escMeta(SITE.title)}">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:title" content="${escMeta(title)}">
  <meta property="og:description" content="${escMeta(desc)}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escMeta(title)}">
  <meta name="twitter:image" content="${ogImage}">`
  );

  // 4) canonical
  html = html.replace(
    /<link rel="canonical" href="">/,
    '<link rel="canonical" href="' + canonical + '">'
  );

  // 5) 注入文章 id（在 app.js 之前），让客户端直接定位文章
  html = html.replace(
    /(<script src="js\/app\.js"><\/script>)/,
    `<script>window.__POST_ID__ = ${JSON.stringify(id)};</script>\n  $1`
  );

  fs.writeFileSync(path.join(outDir, encodeURIComponent(id) + ".html"), html, "utf8");
  count++;
}

console.log("✓ 生成 " + count + " 个文章静态页到 post/（跳过 " + skipped + " 篇无 id）");
console.log("  站点根地址：" + BASE);
