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
 * 2026-10-21 起，静态页里还会写进两样东西：
 *   1) 完整正文 HTML（#postHost 里的 <article>）——只读 <meta> 的话，
 *      百度 / 微信内搜索 / 多数 AI 抓取这些不执行 JS 的爬虫看不到正文。
 *      app.js 加载后会 hydrate：直接取用页面里已有的正文，不重复请求。
 *   2) JSON-LD（BlogPosting）结构化数据，给搜索引擎机器可读的元信息。
 *
 * 用法：在 personal-blog 目录下执行
 *     node tools/build-posts.js
 * 零依赖，只用 Node 内置模块。改完文章记得跑一次（已并入 build-all.js）。
 * =========================================================== */

const fs = require("fs");
const path = require("path");
const { injectStats } = require("./stats.js");

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
/* 下面几个是从 app.js 逐字搬过来的，目的是让「构建时写死的静态正文」
   和「JS 渲染出来的正文」结构完全一致，用户端接管时不会跳变。 */
function firstChar(t) {
  var s = String(t || "").trim();
  return s ? s.charAt(0) : "·";
}
function toneOf(p) {
  var h = 0, s = String(p.id || p.title || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "tone-" + ((h % 5) + 1);
}
function fmtDateCN(iso) {
  var p = String(iso || "").split("-");
  return p[0] + "年" + (parseInt(p[1], 10) || "") + "月" + (parseInt(p[2], 10) || "") + "日";
}

/* 静态正文（2026-10-21 新增）。
 * 之前静态页只有 <meta> 里的标题+摘要，正文靠 JS 从 js/posts/<n>.js 渲染。
 * 不执行 JS 的爬虫（百度、微信内搜索、多数 AI 抓取）因此只能看到摘要，
 * 看不到正文。这里把正文 HTML 直接写进 #postHost，爬虫能读到全文。
 * 结构与 app.js 的 initPost 渲染保持一致；JS 加载后会「hydrate」——
 * 直接取用页面里已有的正文（见 app.js），用户端不闪烁、也不再发一次请求。 */
function staticArticleHTML(p) {
  var cover =
    '<span class="cover-char" aria-hidden="true">' + escMeta(firstChar(p.title)) + "</span>";
  if (p.cover) {
    cover +=
      '<img src="' + escMeta(p.cover) + '" alt="' + escMeta(p.coverAlt || p.title) +
      '" loading="lazy" decoding="async">';
  }
  var caption =
    p.cover && p.coverAlt ? '<p class="cover-caption">' + escMeta(p.coverAlt) + "</p>" : "";
  return (
    '<article class="article">' +
      // 带上本篇 id：点回去时首页会定位到这篇文章（与 app.js 渲染一致）
      '<a class="back-link" href="index.html#post-' + encodeURIComponent(p.id) + '">← 返回首页</a>' +
      "<h1>" + escMeta(p.title) + "</h1>" +
      '<div class="article-meta">' +
        "<span>" + escMeta(fmtDateCN(p.date)) + "</span>" +
        '<span class="dot">·</span>' +
        "<span>" + escMeta(SITE.author) + "</span>" +
      "</div>" +
      '<figure class="article-cover ' + toneOf(p) + '">' + cover + "</figure>" +
      caption +
      // 注意保留 id="articleBody"：app.js 靠它取到静态正文做 hydrate
      '<div class="article-body" id="articleBody">' + (p.content || "") + "</div>" +
    "</article>"
  );
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
  //    用函数式替换：标题/摘要里出现 $ 时不会被当成 replace 的特殊 pattern
  html = html.replace(/<title>[\s\S]*?<\/title>/, function () {
    return "<title>" + escMeta(title) + "</title>";
  });
  html = html.replace(/<meta name="description" content="[^"]*">/, function () {
    return '<meta name="description" content="' + escMeta(desc) + '">';
  });

  // 3) 分享 meta 整段替换（注释行 + og/twitter）
  //    同样用函数式替换，标题里带 $ 也不会坏
  html = html.replace(
    /<!-- 分享卡片：[\s\S]*?twitter:image" content="[^"]*">/,
    function () {
      return `<!-- 本文静态分享信息：供微信/社交爬虫直接读取，无需执行 JS -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escMeta(SITE.title)}">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:title" content="${escMeta(title)}">
  <meta property="og:description" content="${escMeta(desc)}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escMeta(title)}">
  <meta name="twitter:image" content="${ogImage}">`;
    }
  );

  // 4) canonical
  html = html.replace(/<link rel="canonical" href="">/, function () {
    return '<link rel="canonical" href="' + canonical + '">';
  });

  // 5) 注入文章 id（在 app.js 之前），让客户端直接定位文章
  html = html.replace(
    /(<script src="js\/app\.js"><\/script>)/,
    function (m) {
      return '<script>window.__POST_ID__ = ' + JSON.stringify(id) + ';</script>\n  ' + m;
    }
  );

  // 6) 注入静态正文：让不跑 JS 的爬虫也能读到全文（详见 staticArticleHTML 注释）
  //    用函数式替换，避免正文里出现 $ 符号被当成 replace 的特殊 pattern
  html = html.replace(
    /<div id="postHost"><\/div>/,
    function () {
      return '<div id="postHost">' + staticArticleHTML(p) + "</div>";
    }
  );

  // 7) JSON-LD 结构化数据（Article）：给搜索引擎一份机器可读的
  //    标题 / 发布日期 / 作者 / 头图。把 < 转义成 \u003c，防止正文标题里的
  //    尖括号把 <script> 提前闭合。
  var jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    headline: p.title,
    description: desc,
    image: ogImage,
    datePublished: p.date,
    dateModified: p.date,
    author: { "@type": "Person", "name": SITE.author },
    publisher: { "@type": "Organization", "name": SITE.title },
    url: canonical
  }).replace(/</g, "\\u003c");
  html = html.replace("</head>", function () {
    return '<script type="application/ld+json">' + jsonld + "</script>\n</head>";
  });

  // 8) 访问统计脚本（SITE.stats 配置了才注入；没配则页面零改动）
  html = injectStats(html, SITE);

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

  // 访问统计（幂等，与 og 同步互不影响；SITE.stats 没配就不动页面）
  h = injectStats(h, SITE);

  fs.writeFileSync(fp, h, "utf8");
  patched++;
}
console.log("✓ 站点级分享 meta 已同步为绝对地址：" + patched + " 个页面（index/archive/links/about）");
console.log("  站点根地址：" + BASE);

/* ---------- post.html 老入口（?id= 动态页）只注入统计 ----------
 * 它的 og 保持站点默认图（动态页，分享图由 JS 兜底），不参与上面的 og 同步，
 * 但统计脚本要和其他页面一致。 */
{
  const fp = path.join(ROOT, "post.html");
  if (fs.existsSync(fp)) {
    const raw = fs.readFileSync(fp, "utf8");
    const out = injectStats(raw, SITE);
    if (out !== raw) fs.writeFileSync(fp, out, "utf8");
  }
}
