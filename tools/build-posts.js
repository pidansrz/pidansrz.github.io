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

/* 统一换行符为 LF：Windows 上 git checkout 会把 post.html 变成 CRLF，
   下面的正则（以及生成的空行）会因 \r 跟 CI（Linux/LF）产出不一致，
   导致每次本地构建都「全量改写」post/*.html。先归一，保证生成结果可复现。 */
tpl = tpl.replace(/\r\n/g, "\n");

/* 生成的规范页已是 post/<id>.html，不需要 post.html 里的「旧链接重定向」死代码，
   在模板阶段就剔除（靠 OLD_LINK_REDIRECT_START/END 标记定位）。 */
tpl = tpl.replace(
  /<!-- OLD_LINK_REDIRECT_START -->[\s\S]*?<!-- OLD_LINK_REDIRECT_END -->\n?/,
  ""
);

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

/* ---------- 首页 / 归档 / 关于：分享图同样必须绝对地址 ----------
 * 这三个是手写静态页，微信分享站点根、归档页、关于页时读的就是它们。
 * 之前 og:image 是相对路径（images/og-default.jpg），微信不拼基准地址 → 分享图缺失。
 * 这里统一按 SITE.url 改写，换域名时重跑一次构建即可全部同步，不用手改 html。 */
function toAbs(v) {
  const s = String(v == null ? "" : v);
  if (!s) return "";
  if (/^https?:/i.test(s)) {
    // 已是绝对地址：换域名时按「路径部分」重新拼，保证跟着 SITE.url 变
    try { return BASE + new URL(s).pathname; } catch (e) { return s; }
  }
  return BASE + "/" + s.replace(/^\.?\//, "");
}

const OG_DEFAULT_ABS = toAbs("images/og-default.jpg");
const rootPages = [
  { file: "index.html",   url: BASE + "/" },
  { file: "archive.html", url: BASE + "/archive.html" },
  { file: "links.html",   url: BASE + "/links.html" },
  { file: "about.html",   url: BASE + "/about.html" }
];
let patched = 0;
for (const pg of rootPages) {
  const fp = path.join(ROOT, pg.file);
  if (!fs.existsSync(fp)) continue;
  let h = fs.readFileSync(fp, "utf8").replace(/\r\n/g, "\n"); // 同上，归一为 LF

  // og:image（必改）+ twitter:image（没有就补）
  h = h.replace(/(<meta property="og:image" content=")[^"]*(">)/, "$1" + OG_DEFAULT_ABS + "$2");
  if (/<meta name="twitter:image"/.test(h)) {
    h = h.replace(/(<meta name="twitter:image" content=")[^"]*(">)/, "$1" + OG_DEFAULT_ABS + "$2");
  } else {
    h = h.replace(
      /(<meta property="og:image" content="[^"]*">)/,
      '$1\n<meta name="twitter:image" content="' + OG_DEFAULT_ABS + '">'
    );
  }
  // og:url（没有就补在 og:image 后面）
  if (/<meta property="og:url"/.test(h)) {
    h = h.replace(/(<meta property="og:url" content=")[^"]*(">)/, "$1" + pg.url + "$2");
  } else {
    h = h.replace(
      /(<meta property="og:image" content="[^"]*">)/,
      '$1\n<meta property="og:url" content="' + pg.url + '">'
    );
  }
  // canonical（没有就补在 charset 后面）
  if (/<link rel="canonical"/.test(h)) {
    h = h.replace(/(<link rel="canonical" href=")[^"]*(">)/, "$1" + pg.url + "$2");
  } else {
    h = h.replace(
      /(<meta charset="UTF-8">)/,
      '$1\n<link rel="canonical" href="' + pg.url + '">'
    );
  }

  fs.writeFileSync(fp, h, "utf8");
  patched++;
}
console.log("✓ 站点级分享 meta 已同步为绝对地址：" + patched + " 个页面（index/archive/about）");
console.log("  站点根地址：" + BASE);
